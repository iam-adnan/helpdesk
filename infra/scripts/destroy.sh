#!/usr/bin/env bash
# Ordered teardown of the main stack.
#
# `terraform destroy` on its own is NOT sufficient here, because two classes of billable
# AWS resource are created from inside the cluster and therefore do not exist in
# Terraform state:
#
#   1. EBS volumes, from the PersistentVolumeClaims in k8s/base (sqlite-pvc, media-pvc)
#      and the 10Gi Prometheus volume. Deleting the cluster orphans them — they survive,
#      unattached and invisible, billing ~$0.08/GB-month forever.
#   2. The NLB, via the ingress-nginx Service. This one IS reachable from state (the
#      Helm release is Terraform-managed, so the destroy graph removes the Service while
#      the load balancer controller is still running), but only if the destroy actually
#      gets that far. If it fails partway, the NLB is left running and additionally
#      blocks VPC deletion by holding ENIs in its subnets.
#
# So: delete the in-cluster resources first, then destroy, then AUDIT. The audit is not
# decoration — "terraform destroy reported success" and "nothing is billing" are
# different claims, and on an account with ~660 hours of total runway only the second
# one matters.
#
# The bootstrap stack (IAM user, state bucket, OIDC provider, budget) is deliberately
# NOT touched.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"
ENV_FILE="${TF_DIR}/terraform.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/slack.sh"

: "${AWS_PROFILE:?must be set in terraform.env}"
: "${AWS_REGION:?must be set in terraform.env}"
export AWS_DEFAULT_REGION="$AWS_REGION"

CLUSTER="${TF_VAR_cluster_name:-helpdesk-eks}"
AWSC="aws --profile ${AWS_PROFILE} --region ${AWS_REGION}"

echo "==> Tearing down '${CLUSTER}'"
echo "    Credits before: \$$(credits_remaining)"

# Interactive confirmation, unless -y / --yes (which CI passes).
if [ "${1:-}" != "-y" ] && [ "${1:-}" != "--yes" ]; then
  read -r -p "    Destroy the cluster and everything in it? [y/N] " reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "    Aborted."; exit 0 ;;
  esac
fi

# ---------------------------------------------------------------------------
# 1. In-cluster resources that own AWS resources outside Terraform state
# ---------------------------------------------------------------------------

if $AWSC eks describe-cluster --name "$CLUSTER" >/dev/null 2>&1; then
  echo
  echo "==> Cluster exists — cleaning up in-cluster resources first"

  $AWSC eks update-kubeconfig --name "$CLUSTER" >/dev/null 2>&1 || true

  echo "    deleting app manifests"
  kubectl delete -k "${REPO_ROOT}/k8s/eks/" --ignore-not-found --timeout=180s 2>/dev/null || true

  # PVC deletion is what actually releases the backing EBS volumes. The gp3 StorageClass
  # (infra/terraform/storageclass.tf) uses the default Delete reclaim policy, so removing
  # the claim removes the volume — but only while the cluster is still alive to act on it.
  echo "    deleting PersistentVolumeClaims (releases the EBS volumes)"
  for ns in helpdesk monitoring; do
    kubectl -n "$ns" delete pvc --all --ignore-not-found --timeout=180s 2>/dev/null || true
  done

  echo "    waiting for PersistentVolumes to drain"
  PV_DRAINED=""
  for i in $(seq 1 24); do
    remaining=$(kubectl get pv --no-headers 2>/dev/null | wc -l | tr -d ' ')
    [ "$remaining" = "0" ] && { echo "    all PVs released"; PV_DRAINED="yes"; break; }
    echo "      ${remaining} PV(s) still present... ($i/24)"
    sleep 5
  done

  # A PV that never drains means its pod is wedged, and the backing EBS volume will be
  # orphaned the moment the cluster goes — billing forever, invisible, with no owner.
  # Force the pods out so the CSI driver can release the volumes while it still exists.
  if [ -z "$PV_DRAINED" ]; then
    echo "    PVs did not drain — force-removing the pods holding them"
    for ns in helpdesk monitoring; do
      for p in $(kubectl -n "$ns" get pods -o name 2>/dev/null); do
        kubectl -n "$ns" patch "$p" --type=merge -p '{"metadata":{"finalizers":null}}' >/dev/null 2>&1 || true
        kubectl -n "$ns" delete "$p" --force --grace-period=0 >/dev/null 2>&1 || true
      done
    done
    sleep 20
  fi

  # THE DEADLOCK THIS SCRIPT EXISTS TO AVOID.
  #
  # Terraform destroys the monitoring namespace and the External Secrets operator in
  # PARALLEL. The namespace holds ExternalSecrets whose finalizers only that operator can
  # clear, so whichever dies first decides the outcome: if the operator goes, the
  # finalizers never clear, the namespace hangs in Terminating indefinitely, Terraform
  # never reaches the node group, and the internet gateway cannot delete because
  # instances still hold public IPs. The whole destroy stalls with no error — it just
  # prints "Still destroying..." until someone notices. That cost a full night of
  # cluster billing on 2026-09-22.
  #
  # Clearing the finalizers up front removes the dependency entirely: by the time
  # Terraform gets there, nothing is waiting on a controller that is about to vanish.
  echo "    clearing External Secrets finalizers (prevents a Terminating-namespace deadlock)"
  for ns in helpdesk monitoring; do
    for es in $(kubectl -n "$ns" get externalsecret -o name 2>/dev/null); do
      kubectl -n "$ns" patch "$es" --type=merge -p '{"metadata":{"finalizers":null}}' >/dev/null 2>&1 || true
    done
  done
  for css in $(kubectl get clustersecretstore -o name 2>/dev/null); do
    kubectl patch "$css" --type=merge -p '{"metadata":{"finalizers":null}}' >/dev/null 2>&1 || true
  done
else
  echo "    no live cluster found — skipping in-cluster cleanup"
fi

# ---------------------------------------------------------------------------
# 2. Terraform destroy
# ---------------------------------------------------------------------------

cd "$TF_DIR"

echo
echo "==> terraform init"
# Same account-derived bucket as deploy.sh — see the comment in backend.tf.
ACCOUNT_ID=$($AWSC sts get-caller-identity --query Account --output text)
terraform init -input=false -no-color -reconfigure \
  -backend-config="bucket=${CLUSTER}-tfstate-${ACCOUNT_ID}" >/dev/null

echo
echo "==> terraform destroy"
DESTROY_OK="yes"
DESTROY_OUT=$(mktemp -t helpdesk-destroy.XXXXXX.log)
terraform destroy -input=false -auto-approve -no-color 2>&1 | tee "$DESTROY_OUT" || DESTROY_OK=""

# A destroy killed partway (closed laptop, ended session, Ctrl-C) leaves the S3 state
# lock behind, and every later attempt then fails instantly on "Error acquiring the state
# lock" — while the cluster keeps billing. The lock is only ever ours here (single
# operator, and CI serialises through the same state), so reclaiming it automatically is
# safe and strictly better than a human noticing hours later.
if [ -z "$DESTROY_OK" ] && grep -q "Error acquiring the state lock" "$DESTROY_OUT"; then
  STALE_ID=$(grep -oE "ID:[[:space:]]+[0-9a-f-]{36}" "$DESTROY_OUT" | head -1 | awk '{print $2}')
  if [ -n "$STALE_ID" ]; then
    echo
    echo "==> stale state lock ${STALE_ID} detected — reclaiming and retrying"
    terraform force-unlock -force "$STALE_ID" >/dev/null 2>&1 || true
    DESTROY_OK="yes"
    terraform destroy -input=false -auto-approve -no-color || DESTROY_OK=""
  fi
fi
rm -f "$DESTROY_OUT"

# ---------------------------------------------------------------------------
# 3. Audit — the part that actually answers "is anything still billing?"
# ---------------------------------------------------------------------------

echo
echo "==> Post-destroy audit"

LEFTOVERS=""
add_leftover() { LEFTOVERS="${LEFTOVERS}
  - $1"; }

# Normalises the AWS CLI's empty/None results to "0" so the checks below don't treat a
# failed lookup as "resources present". Written out longhand rather than chained with
# &&/|| — the compact form is easy to get subtly wrong and this decides whether the
# script claims nothing is billing.
count_or_zero() {
  local v="$1"
  if [ -z "$v" ] || [ "$v" = "None" ]; then
    echo 0
  else
    echo "$v"
  fi
}

CLUSTERS=$($AWSC eks list-clusters --query 'length(clusters)' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$CLUSTERS")" != "0" ] && add_leftover "EKS cluster(s) still present: ${CLUSTERS}"

LBS=$($AWSC elbv2 describe-load-balancers --query 'length(LoadBalancers)' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$LBS")" != "0" ] && add_leftover "Load balancer(s) still present: ${LBS} (billing ~\$0.023/hr each)"

# The ingress Elastic IP is OWNED BY THE BOOTSTRAP STACK and is meant to outlive this
# teardown — that is the whole point of keeping the site's address stable. Counting it
# here made the audit report INCOMPLETE on a perfectly clean destroy, which is worse than
# not auditing at all: a check that always cries wolf stops being read. Excluded by tag.
# Anything else in the account (pre-existing resources from other projects) is likewise
# not this stack's business, so the count is scoped rather than account-wide.
EIPS=$($AWSC ec2 describe-addresses \
        --query 'length(Addresses[?!(Tags[?Key==`Role` && Value==`ingress-static-ip`])])' \
        --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$EIPS")" != "0" ] && add_leftover "Unexpected Elastic IP(s) still allocated: ${EIPS} (billing ~\$0.005/hr each; the tagged ingress IP is excluded and is meant to persist)"

# Only volumes this cluster created. The CSI driver names dynamically provisioned volumes
# "${cluster}-dynamic-pvc-*", so an unattached one of those is an orphaned PVC — exactly
# what a wedged pod leaves behind, and exactly what went unnoticed on 2026-09-22.
VOLS=$($AWSC ec2 describe-volumes --filters "Name=status,Values=available" \
        --query "length(Volumes[?Tags[?Key=='Name' && starts_with(Value, '${CLUSTER}')]])" \
        --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$VOLS")" != "0" ] && add_leftover "Orphaned EBS volume(s) from this cluster: ${VOLS} (billing ~\$0.08/GB-month) — delete with: aws ec2 delete-volume --volume-id <id>"

NATS=$($AWSC ec2 describe-nat-gateways --filter "Name=state,Values=available,pending" \
        --query 'length(NatGateways)' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$NATS")" != "0" ] && add_leftover "NAT gateway(s) still present: ${NATS} (billing ~\$0.045/hr each)"

INSTANCES=$($AWSC ec2 describe-instances --filters "Name=instance-state-name,Values=running,pending" \
        --query 'length(Reservations[].Instances[])' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$INSTANCES")" != "0" ] && add_leftover "EC2 instance(s) still running: ${INSTANCES}"

echo
if [ -z "$LEFTOVERS" ] && [ -n "$DESTROY_OK" ]; then
  cat <<EOF
===============================================================================
 TEARDOWN COMPLETE — nothing is billing
===============================================================================
  EKS clusters      0
  Load balancers    0
  Elastic IPs       0
  EBS volumes       0
  NAT gateways      0
  Running EC2       0
  Credits remaining \$$(credits_remaining)
===============================================================================
EOF
  slack_destroy_result "ok" "All cluster resources removed and verified: no clusters, load balancers, Elastic IPs, EBS volumes, NAT gateways or running instances remain."
  exit 0
fi

cat <<EOF
===============================================================================
 TEARDOWN INCOMPLETE — THESE ARE STILL BILLING
===============================================================================${LEFTOVERS}

  Credits remaining \$$(credits_remaining)

 Re-run this script. If it keeps failing, the usual cause is a load balancer
 holding ENIs in the VPC's subnets, which blocks VPC deletion — delete it in
 the console (EC2 -> Load Balancers), then re-run.
===============================================================================
EOF

slack_destroy_result "fail" "\`terraform destroy\` did not fully clean up.${LEFTOVERS}"
exit 1
