# Lets GitHub Actions authenticate to AWS as a short-lived, scoped IAM role instead of
# static access keys stored in GitHub secrets. The workflow trades a GitHub-issued OIDC
# token for temporary AWS credentials at run time (aws-actions/configure-aws-credentials
# with role-to-assume) — see .github/workflows/cicd.yml's "deploy" job.
#
# No Docker Hub / ECR permissions needed here: the registry is Docker Hub, authenticated
# in CI via the existing DOCKERHUB_USERNAME/DOCKERHUB_TOKEN GitHub secrets, not AWS IAM.
# This role only needs enough AWS access to point kubectl at the cluster.

# The OIDC provider itself is NOT created here any more — it lives in the bootstrap
# stack (infra/terraform/bootstrap/main.tf) and is only read here.
#
# Two reasons it moved. It is account-level infrastructure: there is exactly one per AWS
# account regardless of how many times this cluster is created and destroyed, so churning
# it on every cycle was always wrong. And .github/workflows/infra.yml can now run
# `terraform destroy` from CI — if the provider it authenticates through were in this
# stack, the destroy would delete its own trust anchor partway through and strand the
# rest of the teardown.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Restricts to this specific repo — any branch/tag/PR within it. Tighten further to
    # "repo:${var.github_repository}:ref:refs/heads/main" if only main-branch pushes
    # should ever be able to assume this role.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:*"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.cluster_name}-github-actions-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_trust.json
}

resource "aws_iam_role_policy" "github_deploy_eks_describe" {
  name = "eks-describe-cluster"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["eks:DescribeCluster"]
        Resource = module.eks.cluster_arn
      },
      {
        # Lets the deploy job resolve the site's static IP by tag for its health check,
        # without needing read access to Terraform state or the S3 state bucket.
        # ec2:DescribeAddresses has no resource-level permissions — "*" is the only
        # valid Resource for it, and it exposes nothing but this account's own EIPs.
        Effect   = "Allow"
        Action   = ["ec2:DescribeAddresses"]
        Resource = "*"
      },
    ]
  })
}

# EKS access entry: grants the GitHub deploy role edit-only Kubernetes RBAC access,
# scoped to just the `helpdesk` namespace — not cluster-admin. This is the modern
# EKS access-entry API, not the legacy aws-auth ConfigMap.
resource "aws_eks_access_entry" "github_deploy" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
  type          = "STANDARD"

  # Puts the CI principal in a Kubernetes group so a ClusterRole can grant it the few
  # cluster-scoped verbs it needs (below) without resorting to cluster-admin.
  kubernetes_groups = ["helpdesk-ci"]

  depends_on = [module.eks]
}

resource "aws_eks_access_policy_association" "github_deploy" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy"

  access_scope {
    type = "namespace"
    # "monitoring" as well as "helpdesk": the k8s/eks overlay the deploy job applies
    # contains the Grafana Ingress and two ExternalSecrets that live in monitoring, so a
    # helpdesk-only scope failed the whole `kubectl apply -k` with Forbidden — even
    # though every app resource had already applied cleanly.
    namespaces = ["helpdesk", "monitoring"]
  }

  depends_on = [aws_eks_access_entry.github_deploy]
}

# AmazonEKSEditPolicy is namespace-scoped and covers only built-in API groups, so it
# grants nothing on external-secrets.io CRDs and nothing cluster-wide. Rather than
# promoting CI to cluster-admin, this grants exactly the resources the overlay contains.
resource "kubernetes_cluster_role" "ci_external_secrets" {
  metadata {
    name = "helpdesk-ci-external-secrets"
  }

  # ClusterSecretStore is cluster-scoped, so it cannot be reached by any namespace-scoped
  # grant at all — this rule is the only thing that makes `kubectl apply` of
  # k8s/eks/secretstore.yaml possible from CI.
  rule {
    api_groups = ["external-secrets.io"]
    resources  = ["clustersecretstores", "externalsecrets", "secretstores"]
    verbs      = ["get", "list", "watch", "create", "update", "patch"]
  }

  depends_on = [module.eks]
}

resource "kubernetes_cluster_role_binding" "ci_external_secrets" {
  metadata {
    name = "helpdesk-ci-external-secrets"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.ci_external_secrets.metadata[0].name
  }

  subject {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Group"
    name      = "helpdesk-ci" # matches kubernetes_groups on the access entry above
  }

  depends_on = [module.eks]
}
