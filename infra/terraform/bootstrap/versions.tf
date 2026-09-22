terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Local state, deliberately. This stack's whole job is to create the S3 bucket the
  # MAIN stack stores its state in — it cannot itself live in that bucket without a
  # chicken-and-egg problem. It is applied roughly once and then left alone.
  #
  # Note this state file contains the terraform-eks-admin access key in plaintext
  # (aws_iam_access_key always writes the secret to state). See the design doc §5.6.
}
