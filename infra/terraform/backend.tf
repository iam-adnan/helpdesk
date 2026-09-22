# Remote state in S3, replacing the local state the original versions.tf comment
# described as "deliberate for this project".
#
# That reasoning ("state for a cluster you destroy between sessions doesn't need to
# survive your laptop") holds right up until state is lost while the cluster is UP.
# Then there is no `terraform destroy` path at all, and the resources keep billing at
# ~$0.182/hr against an account with roughly 660 hours of total runway. The cost of
# S3 state here is a few cents; the cost of not having it is the whole account.
#
# The bucket is created by the bootstrap stack (infra/terraform/bootstrap). Backend
# blocks cannot interpolate variables, so the name is literal — it is
# "${cluster_name}-tfstate-${account_id}" and must be changed here by hand if either
# part ever changes.
#
# use_lockfile enables S3-native state locking (a .tflock object alongside the state).
# No DynamoDB table is needed — that requirement went away in Terraform 1.10.
terraform {
  backend "s3" {
    bucket       = "helpdesk-eks-tfstate-064271146369"
    key          = "helpdesk-eks/main.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
