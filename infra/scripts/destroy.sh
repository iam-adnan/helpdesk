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
  for i in $(seq 1 24); do
    remaining=$(kubectl get pv --no-headers 2>/dev/null | wc -l | tr -d ' ')
    [ "$remaining" = "0" ] && { echo "    all PVs released"; break; }
    echo "      ${remaining} PV(s) still present... ($i/24)"
    sleep 5
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
terraform init -input=false -no-color >/dev/null

echo
echo "==> terraform destroy"
DESTROY_OK="yes"
terraform destroy -input=false -auto-approve -no-color || DESTROY_OK=""

# ---------------------------------------------------------------------------
# 3. Audit — the part that actually answers "is anything still billing?"
# ---------------------------------------------------------------------------

echo
echo "==> Post-destroy audit"

LEFTOVERS=""
add_leftover() { LEFTOVERS="${LEFTOVERS}
  - $1"; }

count_or_zero() { local v="$1"; [ -z "$v" ] || [ "$v" = "None" ] && echo 0 || echo "$v"; }

CLUSTERS=$($AWSC eks list-clusters --query 'length(clusters)' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$CLUSTERS")" != "0" ] && add_leftover "EKS cluster(s) still present: ${CLUSTERS}"

LBS=$($AWSC elbv2 describe-load-balancers --query 'length(LoadBalancers)' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$LBS")" != "0" ] && add_leftover "Load balancer(s) still present: ${LBS} (billing ~\$0.023/hr each)"

EIPS=$($AWSC ec2 describe-addresses --query 'length(Addresses)' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$EIPS")" != "0" ] && add_leftover "Elastic IP(s) still allocated: ${EIPS} (billing ~\$0.005/hr each)"

VOLS=$($AWSC ec2 describe-volumes --filters "Name=status,Values=available,in-use" \
        --query 'length(Volumes)' --output text 2>/dev/null || echo 0)
[ "$(count_or_zero "$VOLS")" != "0" ] && add_leftover "EBS volume(s) still present: ${VOLS} (billing ~\$0.08/GB-month)"

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
