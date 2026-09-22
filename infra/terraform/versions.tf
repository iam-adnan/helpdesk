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
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is remote, in S3 — see backend.tf. This used to be local on the reasoning
  # that a cluster destroyed between sessions doesn't need state outliving the laptop.
  # That held until you consider losing state while the cluster is UP: there is then no
  # clean `terraform destroy` path at all, and the resources keep billing. CI also runs
  # apply/destroy now (.github/workflows/infra.yml), so state has to be somewhere both
  # the laptop and the runner can reach.
}
