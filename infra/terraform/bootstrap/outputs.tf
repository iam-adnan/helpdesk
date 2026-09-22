output "terraform_user_name" {
  description = "IAM user the main stack runs as."
  value       = aws_iam_user.terraform.name
}

output "terraform_access_key_id" {
  description = "Access key ID for the Terraform IAM user. bootstrap.sh writes this into ~/.aws/credentials automatically — you shouldn't need to copy it by hand."
  value       = aws_iam_access_key.terraform.id
}

output "terraform_secret_access_key" {
  description = "Secret access key for the Terraform IAM user. Marked sensitive, so read it with `terraform output -raw terraform_secret_access_key` if you ever need it directly."
  value       = aws_iam_access_key.terraform.secret
  sensitive   = true
}

output "tfstate_bucket" {
  description = "S3 bucket holding the MAIN stack's state. This value is baked into infra/terraform/backend.tf — if it ever changes, backend.tf must change with it."
  value       = aws_s3_bucket.tfstate.id
}

output "github_infra_role_arn" {
  description = "Set as the GitHub Actions repo secret AWS_INFRA_ROLE_ARN. Used by .github/workflows/infra.yml to run terraform apply/destroy from CI."
  value       = aws_iam_role.github_infra.arn
}

output "github_oidc_provider_arn" {
  description = "Consumed by the main stack (github-oidc.tf) via a data source rather than being recreated there."
  value       = aws_iam_openid_connect_provider.github.arn
}

output "budget_name" {
  description = "Cost guardrail created by this stack."
  value       = aws_budgets_budget.credit_guardrail.name
}
