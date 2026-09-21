# IRSA (IAM Roles for Service Accounts) for every controller that needs to call the
# AWS API from inside the cluster. Each role is scoped to exactly one Kubernetes
# ServiceAccount (namespace:name) via the cluster's OIDC provider — no node-wide
# IAM permissions, no long-lived AWS keys stored anywhere in the cluster.

module "lb_controller_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "${var.cluster_name}-lb-controller"

  attach_load_balancer_controller_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

module "ebs_csi_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "${var.cluster_name}-ebs-csi"

  attach_ebs_csi_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
}

# External Secrets Operator's ServiceAccount (default namespace/name from the
# `external-secrets` Helm chart, installed in addons.tf) — scoped to read-only on
# exactly the helpdesk/* secrets created in secrets.tf, nothing else in the account.
data "aws_iam_policy_document" "external_secrets_read" {
  statement {
    sid    = "ReadHelpdeskSecrets"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [
      aws_secretsmanager_secret.django_secret_key.arn,
      aws_secretsmanager_secret.cors_allowed_origins.arn,
      aws_secretsmanager_secret.dockerhub_credentials.arn,
    ]
  }
}

resource "aws_iam_policy" "external_secrets_read" {
  name   = "${var.cluster_name}-external-secrets-read"
  policy = data.aws_iam_policy_document.external_secrets_read.json
}

module "external_secrets_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "${var.cluster_name}-external-secrets"

  role_policy_arns = {
    read_helpdesk_secrets = aws_iam_policy.external_secrets_read.arn
  }

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["external-secrets:external-secrets"]
    }
  }
}
