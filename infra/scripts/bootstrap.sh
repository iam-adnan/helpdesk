#!/usr/bin/env bash
# One-time (and safely repeatable) bootstrap of the AWS account.
#
# Creates the things that must OUTLIVE `terraform destroy` of the main stack: the
# Terraform IAM user, the S3 state bucket, the GitHub OIDC provider, the CI infra role,
# and the cost guardrail.
#
# Runs as the account ROOT, because only root can mint the first IAM user. This is the
# only script that ever needs root, and after it succeeds the root access keys should be
# deleted in the AWS Console.
#
# Safe to run any number of times. See "idempotency" below — this handles the case
# Terraform alone gets wrong, where the resources exist in AWS but the local state file
# is gone.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF_DIR="${REPO_ROOT}/infra/terraform/bootstrap"
ENV_FILE="${REPO_ROOT}/infra/terraform/terraform.env"

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: ${ENV_FILE} not found." >&2
  echo "       Copy infra/terraform/terraform.env.example to terraform.env and fill it in." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/slack.sh"

: "${BOOTSTRAP_AWS_PROFILE:?must be set in terraform.env}"
: "${AWS_PROFILE:?must be set in terraform.env}"
: "${AWS_REGION:?must be set in terraform.env}"

TARGET_PROFILE="$AWS_PROFILE"

# Everything in THIS script runs as the bootstrap (root) profile. AWS_PROFILE is
# deliberately overridden for the duration — the profile it names doesn't exist yet;
# creating it is the point of this script.
export AWS_PROFILE="$BOOTSTRAP_AWS_PROFILE"
export AWS_DEFAULT_REGION="$AWS_REGION"

echo "==> Bootstrapping with profile '${BOOTSTRAP_AWS_PROFILE}'"
CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "    Account: ${ACCOUNT_ID}"
echo "    Caller:  ${CALLER_ARN}"
echo "    Credits: \$$(credits_remaining)"

TF_USER="${TF_VAR_terraform_user_name:-terraform-eks-admin}"
CLUSTER="${TF_VAR_cluster_name:-helpdesk-eks}"
BUCKET="${CLUSTER}-tfstate-${ACCOUNT_ID}"

# ---------------------------------------------------------------------------
# Idempotency: reconcile AWS reality with Terraform state
# ---------------------------------------------------------------------------
#
# Terraform natively does "create if missing, skip if present" via state. The case it
# gets WRONG is state loss: the resource still exists in AWS but isn't in state, so
# apply fails EntityAlreadyExists / BucketAlreadyOwnedByYou instead of skipping.
#
# import_if_exists closes that gap. If the address is already managed, nothing happens.
# If not, we attempt an import — which succeeds when the resource exists in AWS, and
# fails harmlessly when it doesn't, leaving Terraform to create it as normal.

cd "$TF_DIR"

echo
echo "==> terraform init"
terraform init -input=false -no-color

import_if_exists() {
  local addr="$1" id="$2"
  if terraform state list 2>/dev/null | grep -qx -- "$addr"; then
    echo "    already in state:  ${addr}"
    return 0
  fi
  if terraform import -input=false -no-color "$addr" "$id" >/dev/null 2>&1; then
    echo "    IMPORTED existing: ${addr}"
    return 0
  fi
  echo "    will be created:   ${addr}"
  return 0
}

echo
echo "==> Reconciling pre-existing resources into state"

# If the IAM user already exists but isn't in state, its access keys are unknown to us
# and their secrets are unrecoverable — AWS only ever shows a secret once, at creation.
# aws_iam_access_key therefore cannot be imported. Terraform will create a fresh key,
# and since IAM caps a user at 2 keys, stale ones must be cleared first or a third
# bootstrap would fail with LimitExceeded.
if aws iam get-user --user-name "$TF_USER" >/dev/null 2>&1; then
  if ! terraform state list 2>/dev/null | grep -qx -- "aws_iam_user.terraform"; then
    echo "    IAM user '${TF_USER}' exists but is absent from state."
    for k in $(aws iam list-access-keys --user-name "$TF_USER" \
                 --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null || true); do
      echo "      deleting orphaned access key ${k} (its secret is unrecoverable)"
      aws iam delete-access-key --user-name "$TF_USER" --access-key-id "$k"
    done
  fi
fi

import_if_exists "aws_iam_user.terraform"                                  "$TF_USER"
import_if_exists "aws_iam_user_policy_attachment.terraform_admin"          "${TF_USER}/arn:aws:iam::aws:policy/AdministratorAccess"
import_if_exists "aws_s3_bucket.tfstate"                                   "$BUCKET"
import_if_exists "aws_s3_bucket_versioning.tfstate"                        "$BUCKET"
import_if_exists "aws_s3_bucket_server_side_encryption_configuration.tfstate" "$BUCKET"
import_if_exists "aws_s3_bucket_public_access_block.tfstate"               "$BUCKET"
import_if_exists "aws_iam_openid_connect_provider.github"                  "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
import_if_exists "aws_iam_role.github_infra"                               "${CLUSTER}-github-actions-infra"
import_if_exists "aws_iam_role_policy_attachment.github_infra_admin"       "${CLUSTER}-github-actions-infra/arn:aws:iam::aws:policy/AdministratorAccess"
import_if_exists "aws_budgets_budget.credit_guardrail"                     "${ACCOUNT_ID}:${CLUSTER}-credit-guardrail"

# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------

echo
echo "==> terraform apply"
if ! terraform apply -input=false -auto-approve -no-color; then
  slack_notify "danger" "❌ Helpdesk bootstrap FAILED" \
    "\`terraform apply\` failed in infra/terraform/bootstrap. No cluster was created, so nothing is billing."
  exit 1
fi

# ---------------------------------------------------------------------------
# Write the Terraform user's credentials to a local profile
# ---------------------------------------------------------------------------
#
# Written as a SEPARATE profile from the bootstrap one, so a failed bootstrap can never
# leave the machine with no working credentials at all.

ACCESS_KEY_ID=$(terraform output -raw terraform_access_key_id)
SECRET_KEY=$(terraform output -raw terraform_secret_access_key)
INFRA_ROLE_ARN=$(terraform output -raw github_infra_role_arn)
STATE_BUCKET=$(terraform output -raw tfstate_bucket)

echo
echo "==> Writing AWS profile '${TARGET_PROFILE}'"
aws configure set aws_access_key_id     "$ACCESS_KEY_ID" --profile "$TARGET_PROFILE"
aws configure set aws_secret_access_key "$SECRET_KEY"    --profile "$TARGET_PROFILE"
aws configure set region                "$AWS_REGION"    --profile "$TARGET_PROFILE"

# New IAM credentials are eventually consistent — they routinely 403 for a few seconds
# after creation. Retry rather than declaring a working bootstrap broken.
echo "==> Verifying '${TARGET_PROFILE}' (IAM credentials are eventually consistent)"
VERIFIED=""
for i in $(seq 1 12); do
  if aws sts get-caller-identity --profile "$TARGET_PROFILE" >/dev/null 2>&1; then
    VERIFIED="yes"
    break
  fi
  echo "    not ready yet ($i/12)..."
  sleep 5
done

if [ -z "$VERIFIED" ]; then
  echo "ERROR: profile '${TARGET_PROFILE}' still cannot authenticate after 60s." >&2
  slack_notify "danger" "⚠️ Helpdesk bootstrap incomplete" \
    "Resources were created but the new IAM credentials never became usable."
  exit 1
fi

NEW_ARN=$(aws sts get-caller-identity --profile "$TARGET_PROFILE" --query Arn --output text)
echo "    OK: ${NEW_ARN}"

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

cat <<EOF

===============================================================================
 BOOTSTRAP COMPLETE
===============================================================================

  AWS account          ${ACCOUNT_ID}
  Terraform IAM user   ${TF_USER}
  Local AWS profile    ${TARGET_PROFILE}
  State bucket         ${STATE_BUCKET}
  CI infra role ARN    ${INFRA_ROLE_ARN}
  Credits remaining    \$$(credits_remaining)

-------------------------------------------------------------------------------
 YOU MUST DO THESE TWO THINGS BY HAND
-------------------------------------------------------------------------------

 1. Add this GitHub repo secret (lets CI run terraform apply/destroy):

      gh secret set AWS_INFRA_ROLE_ARN --body "${INFRA_ROLE_ARN}"

 2. Delete the ROOT access keys in the AWS Console:
      IAM -> My security credentials -> Access keys -> Delete

    Terraform cannot delete the keys it is authenticating with, so this is the
    one step that can never be automated. Leaving them live defeats the purpose
    of creating ${TF_USER} at all.

===============================================================================

EOF

slack_notify "good" "🔑 Helpdesk AWS bootstrap complete" \
"Account \`${ACCOUNT_ID}\` is ready for \`deploy.sh\`.

*Terraform user:* \`${TF_USER}\`
*State bucket:* \`${STATE_BUCKET}\`
*Credits remaining:* \$$(credits_remaining)

_No cluster exists yet — nothing is billing._"
