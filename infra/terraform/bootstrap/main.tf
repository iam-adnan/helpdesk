# Bootstrap stack — everything that must SURVIVE `terraform destroy` of the main stack.
#
# Applied once, as the account root, and then essentially never again. Everything here
# is either a prerequisite for the main stack running at all (the IAM user, the state
# bucket, the OIDC provider) or a guardrail that would be worthless if it disappeared
# with the cluster (the budget).
#
# Why this is a separate stack at all: if aws_iam_user.terraform lived in the main
# stack, `terraform destroy` would delete the very user Terraform was authenticating
# as, fail partway, and strand billable resources with no working credentials to clean
# them up. Same argument for the CI infra role below, which is what a CI-triggered
# destroy runs as. See the design doc §5.1.

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# 1. The IAM user every later `terraform apply` runs as
# ---------------------------------------------------------------------------

# AdministratorAccess is deliberate, not an oversight. Creating an EKS cluster touches
# IAM, EC2, VPC, ELB, EKS, Secrets Manager and Auto Scaling; a hand-scoped policy would
# be a long tail of permission-denied failures to debug against a credit- and
# clock-limited account. Worth tightening once the stack is known-good. Design doc §5.3.
resource "aws_iam_user" "terraform" {
  name = var.terraform_user_name

  # IAM tag values accept ONLY [\p{L}\p{Z}\p{N}_.:/=+\-@] — letters, spaces, digits and
  # _ . : / = + - @. Nothing else. Two live CreateUser ValidationErrors were spent
  # learning this: first an em-dash, then the comma that replaced it. A comma is not on
  # the list either. Keep tag values to words, spaces and hyphens; prose goes in comments.
  tags = {
    Project = var.cluster_name
    Purpose = "Terraform execution identity - replaces account root for day-to-day applies"
  }
}

resource "aws_iam_user_policy_attachment" "terraform_admin" {
  user       = aws_iam_user.terraform.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

resource "aws_iam_access_key" "terraform" {
  user = aws_iam_user.terraform.name
}

# ---------------------------------------------------------------------------
# 2. Remote state bucket for the MAIN stack
# ---------------------------------------------------------------------------

# Losing main-stack state means losing the ability to destroy the cluster cleanly —
# on an account with ~660 hours of total runway, orphaned resources billing at
# $0.182/hr is the most expensive failure available. Versioning is on so a corrupted
# or truncated state push can be rolled back rather than rebuilt by hand.
#
# Bucket names are globally unique, so the account ID is suffixed rather than hoping
# "helpdesk-eks-tfstate" happens to be free.
resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.cluster_name}-tfstate-${data.aws_caller_identity.current.account_id}"

  tags = {
    Project = var.cluster_name
    Purpose = "Terraform remote state for the main stack"
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# 3. GitHub OIDC provider + the CI infra role
# ---------------------------------------------------------------------------

# The OIDC provider is ACCOUNT-level infrastructure, not cluster-level — there is one
# per AWS account no matter how many times the cluster is created and destroyed. It
# lived in the main stack originally; moving it here means a destroy/apply cycle stops
# churning it, and (more importantly) a CI-triggered destroy can't delete the trust
# anchor for the role that is running the destroy.
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

data "aws_iam_policy_document" "github_infra_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Deliberately tighter than the app-deploy role in the main stack, which allows any
    # ref in the repo. This role can create and destroy the entire cluster, so it is
    # restricted to main-branch workflows only — a PR branch must not be able to assume
    # something that can run `terraform destroy`.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_infra" {
  name               = "${var.cluster_name}-github-actions-infra"
  description        = "Assumed by .github/workflows/infra.yml to run terraform apply/destroy on the main stack."
  assume_role_policy = data.aws_iam_policy_document.github_infra_trust.json

  tags = {
    Project = var.cluster_name
  }
}

# Same AdministratorAccess reasoning as the IAM user above — this role runs the exact
# same Terraform, so scoping it more tightly than the user would just move the
# permission-denied failures from the laptop to CI.
resource "aws_iam_role_policy_attachment" "github_infra_admin" {
  role       = aws_iam_role.github_infra.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ---------------------------------------------------------------------------
# 4. Cost guardrail
# ---------------------------------------------------------------------------

# Separate from, and much lower than, the pre-existing "helpdesk-eks-guardrail" budget
# that was set to $180/mo. That figure was calibrated against an assumed $200 credit;
# the account actually holds $120 for six months, so $180 was effectively no guardrail
# at all. The old budget can be deleted in the console — it has already earned its $20
# reward credit and deleting it does not claw that back.
resource "aws_budgets_budget" "credit_guardrail" {
  name         = "${var.cluster_name}-credit-guardrail"
  budget_type  = "COST"
  limit_amount = var.budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [25, 50, 80]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_notification_email]
    }
  }

  # Forecast-based alert as well as actual: an EKS cluster left running overnight is
  # visible in the forecast hours before it shows up in actual spend.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_notification_email]
  }
}
