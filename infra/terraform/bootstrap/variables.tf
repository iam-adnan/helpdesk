variable "aws_region" {
  description = "AWS region. Must match the main stack's aws_region — the state bucket and the cluster should not be split across regions."
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "Must match the main stack's cluster_name. Used to derive resource names so bootstrap and main stay visibly paired."
  type        = string
  default     = "helpdesk-eks"
}

variable "terraform_user_name" {
  description = "IAM user every post-bootstrap `terraform apply` runs as, instead of the account root. bootstrap.sh imports this user if it already exists in AWS but is missing from state (see design doc §5.4) — renaming it after first apply orphans the old user, so pick once."
  type        = string
  default     = "terraform-eks-admin"
}

variable "github_repository" {
  description = "GitHub \"org/repo\" allowed to assume the CI roles via OIDC."
  type        = string
  default     = "iam-adnan/helpdesk"
}

variable "budget_limit_usd" {
  description = "Monthly cost budget in USD. Default is 30, NOT the 180 the original guardrail used: the account holds $120 of credit TOTAL for six months, so a 180 budget's first alert at 50% would only fire after 75% of everything available was already spent. See the design doc §7.1."
  type        = string
  default     = "30"
}

variable "budget_notification_email" {
  description = "Address that receives the 25/50/80% budget alerts."
  type        = string
  default     = "adnan.akram@mindstormstudios.com"
}
