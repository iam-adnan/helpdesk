variable "aws_region" {
  description = "AWS region. us-east-1 is the cheapest/most feature-complete region and every price in the cost plan doc is quoted for it."
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
  default     = "helpdesk-eks"
}

variable "kubernetes_version" {
  description = "EKS control plane version."
  type        = string
  default     = "1.31"
}

variable "enable_nat_gateway" {
  description = "true = worker nodes go in private subnets behind a NAT Gateway (~$33+/mo extra, closer to a real production pattern). false = nodes go in public subnets with a locked-down security group (default, cheapest — see the cost plan doc)."
  type        = bool
  default     = false
}

variable "node_instance_types" {
  description = "Worker node instance type(s). Bump to t3.medium if the six app pods + system add-on pods don't all schedule on 2x t3.small."
  type        = list(string)
  default     = ["t3.small"]
}

variable "node_desired_size" {
  type    = number
  default = 2
}

variable "github_repository" {
  description = "GitHub \"org/repo\" allowed to assume the GitHub Actions deploy role via OIDC. Restricts which repo's workflows can authenticate as this role."
  type        = string
  default     = "iam-adnan/helpdesk"
}

variable "dockerhub_username" {
  description = "Docker Hub username, stored in AWS Secrets Manager for the (optional) imagePullSecret — only needed if the helpdesk-backend/helpdesk-frontend Docker Hub repos are private. Pass via TF_VAR_dockerhub_username or terraform.tfvars (gitignored), never commit a real value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "dockerhub_token" {
  description = "Docker Hub access token (Account Settings -> Security -> New Access Token, Read-only scope is enough for pulls), stored in AWS Secrets Manager. Pass via TF_VAR_dockerhub_token or terraform.tfvars (gitignored), never commit a real value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cors_allowed_origins" {
  description = "Value for the app's CORS_ALLOWED_ORIGINS runtime secret. Circular on a fresh cluster (the ALB hostname doesn't exist until after apply) — leave the default on first apply, then update via `terraform apply -var cors_allowed_origins=http://<alb-hostname>` once Task 6/11's Ingress has a real ADDRESS, or set it once a real domain is in front of the ALB."
  type        = string
  default     = "http://localhost:3000,http://localhost"
}
