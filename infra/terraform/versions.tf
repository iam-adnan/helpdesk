terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.14"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Local state by default — deliberate for this project. State for a cluster you
  # intend to `terraform destroy` between every session (see the cost plan in
  # docs/superpowers/plans/2026-09-21-aws-eks-migration.md) doesn't need to survive
  # your laptop; an S3+DynamoDB remote backend is one block to add later if this
  # becomes a team-shared, always-on environment.
}
