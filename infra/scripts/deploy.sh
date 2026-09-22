#!/usr/bin/env bash
# Full deploy: Terraform (cluster + static IP + addons) then the app manifests.
#
# Runs as the terraform-eks-admin IAM user created by bootstrap.sh, never as root.
# Reports start / success / failure to Slack, with the static IP and the account's
# remaining credit in the success message.
#
# This is the same work .github/workflows/infra.yml does from CI. It exists as a script
# so the first run (before AWS_INFRA_ROLE_ARN can possibly be set, because the role it
# names is created by this very apply) can happen locally.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform"
ENV_FILE="${TF_DIR}/terraform.env"
LOG_FILE="$(mktemp -t helpdesk-deploy.XXXXXX.log)"

START_TS=$(date +%s)

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found. Copy terraform.env.example and fill it in." >&2
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

# fail <stage> — notify Slack with the tail of the log, then exit. Trapped stages call
# this instead of dying silently, because a failed apply can still have created billable
# resources and the operator needs to know to check.
fail() {
  local stage="$1"
  local tail_text
  tail_text=$(tail -n 20 "$LOG_FILE" 2>/dev/null | sed 's/`/'"'"'/g' || echo "(no log output)")
  echo >&2
  echo "ERROR: failed at stage: ${stage}" >&2
  echo "       full log: ${LOG_FILE}" >&2
  slack_deploy_failure "$stage" "$tail_text"
  exit 1
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

echo "==> Preflight"
for tool in terraform aws kubectl helm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: '$tool' not on PATH." >&2; exit 1; }
done

# The Terraform helm provider does NOT fetch a chart repository index on demand — it
# reads the same local cache the helm CLI uses, and fails the whole apply with
# "could not download chart: no cached repo found" if an index is missing. On Windows
# that cache lives under %TEMP% (`helm env` -> HELM_REPOSITORY_CACHE), which is wiped
# periodically, so a deploy that worked yesterday can fail today on an untouched config.
# Registering and refreshing the repos here makes the script self-healing rather than
# dependent on the operator's machine state.
echo "==> Ensuring helm chart repositories are cached"
helm repo add eks-charts           https://aws.github.io/eks-charts                  >/dev/null 2>&1 || true
helm repo add metrics-server       https://kubernetes-sigs.github.io/metrics-server/ >/dev/null 2>&1 || true
helm repo add external-secrets     https://charts.external-secrets.io                >/dev/null 2>&1 || true
helm repo add ingress-nginx        https://kubernetes.github.io/ingress-nginx        >/dev/null 2>&1 || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null 2>&1 || true
helm repo update >/dev/null 2>&1 || echo "  WARNING: 'helm repo update' failed; chart downloads may fail." >&2

aws sts get-caller-identity --profile "$AWS_PROFILE" >/dev/null 2>&1 \
  || { echo "ERROR: profile '${AWS_PROFILE}' cannot authenticate. Run bootstrap.sh first." >&2; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
CALLER=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Arn --output text)
echo "    Account: ${ACCOUNT_ID}"
echo "    Caller:  ${CALLER}"

case "$CALLER" in
  *":root")
    echo "WARNING: running as the account ROOT. bootstrap.sh should have created" >&2
    echo "         terraform-eks-admin — check AWS_PROFILE in terraform.env." >&2
    ;;
esac

echo "    Credits: \$$(credits_remaining)"

slack_notify "#3aa3e3" "🚀 Deploying helpdesk to EKS" \
"*Account:* \`${ACCOUNT_ID}\`
*Region:* \`${AWS_REGION}\`
*Cluster:* \`${CLUSTER}\`
*Credits remaining:* \$$(credits_remaining)

_Creating the cluster takes roughly 15 minutes._"

# ---------------------------------------------------------------------------
# Terraform
# ---------------------------------------------------------------------------

cd "$TF_DIR"

echo
echo "==> terraform init"
# Bucket is supplied here rather than in backend.tf — it embeds the account ID, so it
# has to follow the credentials actually in use. See the comment in backend.tf.
STATE_BUCKET="${CLUSTER}-tfstate-${ACCOUNT_ID}"
echo "    state bucket: ${STATE_BUCKET}"
terraform init -input=false -no-color -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" 2>&1 | tee "$LOG_FILE" || fail "terraform init"

echo
echo "==> terraform plan"
terraform plan -input=false -no-color -out=tfplan 2>&1 | tee "$LOG_FILE" || fail "terraform plan"

echo
echo "==> terraform apply (this is where spend starts)"
terraform apply -input=false -no-color tfplan 2>&1 | tee "$LOG_FILE" || fail "terraform apply"

PLAN_SUMMARY=$(grep -E '^Apply complete!' "$LOG_FILE" | tail -n 1 || echo "apply completed")

WEBSITE_IP=$(terraform output -raw website_ip)
WEBSITE_URL=$(terraform output -raw website_url)
GRAFANA_URL=$(terraform output -raw grafana_url)
DEPLOY_ROLE_ARN=$(terraform output -raw github_deploy_role_arn)

echo
echo "    Static IP: ${WEBSITE_IP}"

# ---------------------------------------------------------------------------
# Application manifests
# ---------------------------------------------------------------------------

echo
echo "==> Updating kubeconfig"
aws eks update-kubeconfig --name "$CLUSTER" --region "$AWS_REGION" --profile "$AWS_PROFILE" \
  2>&1 | tee "$LOG_FILE" || fail "aws eks update-kubeconfig"

echo
echo "==> kubectl apply -k k8s/eks/"

# The manifests carry BACKEND_IMAGE_PLACEHOLDER / FRONTEND_IMAGE_PLACEHOLDER, which CI
# replaces with `kubectl set image` AFTER applying. That ordering is fine in CI, but it
# means re-running this script against a cluster that is already serving traffic would
# reset every Deployment back to an invalid image and take the site down —
# InvalidImageName, no rollback, until someone re-sets them by hand.
#
# So: capture whatever real images are deployed now, apply, then put them back. On a
# first deploy there is nothing to capture and this is a no-op.
declare -A PREV_IMAGES
for d in backend celery frontend slack-bot; do
  img=$(kubectl -n helpdesk get deploy "$d" \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
  case "$img" in
    ""|*PLACEHOLDER*) ;;                       # absent, or never deployed for real
    *) PREV_IMAGES["$d"]="$img" ;;
  esac
done

kubectl apply -k "${REPO_ROOT}/k8s/eks/" 2>&1 | tee "$LOG_FILE" || fail "kubectl apply"

if [ ${#PREV_IMAGES[@]} -gt 0 ]; then
  echo "    restoring ${#PREV_IMAGES[@]} live image(s) the apply reset to placeholders"
  for d in "${!PREV_IMAGES[@]}"; do
    img="${PREV_IMAGES[$d]}"
    if [ "$d" = "backend" ]; then
      # `set image` matches by container NAME, and backend has an initContainer
      # (migrate) running the same image — miss it and the pod never leaves Init.
      kubectl -n helpdesk set image "deployment/$d" "migrate=$img" "backend=$img" >/dev/null
    else
      kubectl -n helpdesk set image "deployment/$d" "$d=$img" >/dev/null
    fi
    echo "      $d -> $img"
  done
fi

# The Deployments reference BACKEND_IMAGE_PLACEHOLDER / FRONTEND_IMAGE_PLACEHOLDER until
# CI substitutes real tags via `kubectl set image`. On a first deploy, before the
# pipeline has ever run against this cluster, those pods cannot start — so a rollout
# wait here would always time out. Waiting for that is the CI pipeline's job, not this
# script's; this script's contract is that the CLUSTER and the STATIC IP are ready.
echo
echo "==> Waiting for ingress-nginx to be serving"
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=300s \
  2>&1 | tee "$LOG_FILE" || fail "ingress-nginx rollout"

# ---------------------------------------------------------------------------
# Verify the static IP is actually what the NLB answers on
# ---------------------------------------------------------------------------
#
# Terraform having allocated the EIP does NOT prove the NLB picked it up — a mismatched
# eip-allocations/subnets count, for instance, silently yields AWS-assigned addresses
# instead. Assert it rather than assume it.

echo
echo "==> Verifying NLB is bound to the Elastic IP"
NLB_OK=""
for i in $(seq 1 20); do
  MAPPED=$(aws ec2 describe-network-interfaces \
    --profile "$AWS_PROFILE" --region "$AWS_REGION" \
    --filters "Name=association.public-ip,Values=${WEBSITE_IP}" \
    --query 'NetworkInterfaces[0].Description' --output text 2>/dev/null || echo "None")
  if [ "$MAPPED" != "None" ] && [ -n "$MAPPED" ]; then
    echo "    bound: ${MAPPED}"
    NLB_OK="yes"
    break
  fi
  echo "    waiting for the NLB to claim ${WEBSITE_IP}... ($i/20)"
  sleep 15
done
[ -n "$NLB_OK" ] || echo "WARNING: ${WEBSITE_IP} is not attached to any ENI yet — the NLB may still be provisioning." >&2

END_TS=$(date +%s)
DURATION=$((END_TS - START_TS))

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

cat <<EOF

===============================================================================
 DEPLOY COMPLETE
===============================================================================

  Site              ${WEBSITE_URL}
  Static IP         ${WEBSITE_IP}
  Grafana           ${GRAFANA_URL}
  Cluster           ${CLUSTER}
  Duration          $((DURATION / 60))m $((DURATION % 60))s
  Credits remaining \$$(credits_remaining)

-------------------------------------------------------------------------------
 GITHUB REPO SECRET / VARIABLE TO SET (once)
-------------------------------------------------------------------------------

   gh secret set AWS_DEPLOY_ROLE_ARN --body "${DEPLOY_ROLE_ARN}"
   gh variable set EKS_DEPLOY_ENABLED --body "true"

 Until EKS_DEPLOY_ENABLED is "true", merges to main build and push images but
 skip the deploy entirely.

-------------------------------------------------------------------------------
 THIS CLUSTER IS NOW BILLING AT ~\$0.182/hr (~\$4.37/day)
 Run infra/scripts/destroy.sh when you are done with it.
-------------------------------------------------------------------------------

EOF

slack_deploy_success "$WEBSITE_IP" "$WEBSITE_URL" "$GRAFANA_URL" "$DURATION" "$PLAN_SUMMARY"

rm -f "$LOG_FILE"
