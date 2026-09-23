module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = var.enable_nat_gateway ? module.vpc.private_subnets : module.vpc.public_subnets

  # Public endpoint so `kubectl`/CI can reach the API server without a VPN/bastion —
  # an accepted tradeoff for a short-lived learning/demo cluster, not a real production
  # pattern (a production cluster would restrict this to a known CIDR or go private-only).
  cluster_endpoint_public_access = true

  enable_irsa = true

  eks_managed_node_groups = {
    default = {
      instance_types = var.node_instance_types
      capacity_type  = var.node_capacity_type
      # min and max must differ or there is nothing for Cluster Autoscaler to do: it
      # moves the ASG's desired capacity inside this range, and a group pinned at
      # min == max silently ignores every scale-up decision it makes.
      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size
      subnet_ids   = var.enable_nat_gateway ? module.vpc.private_subnets : module.vpc.public_subnets
    }
  }

  # Modern EKS access-entry API (not the legacy aws-auth ConfigMap) — the caller running
  # `terraform apply` gets cluster-admin automatically; the GitHub Actions deploy role
  # (irsa.tf / github-oidc.tf) is granted its own scoped-down access entry separately.
  authentication_mode                      = "API_AND_CONFIG_MAP"
  enable_cluster_creator_admin_permissions = true

  tags = {
    Project = "helpdesk-eks"
  }
}
