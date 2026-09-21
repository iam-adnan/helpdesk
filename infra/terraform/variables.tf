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
  description = "Worker node instance type(s). Defaults to t3.medium (not t3.small) because the monitoring stack (kube-prometheus-stack: Prometheus, Grafana, Alertmanager, kube-state-metrics, a node-exporter DaemonSet) adds roughly another 0.5-0.7 vCPU / 1-1.5Gi of pod requests on top of the six app pods + ALB controller/EBS CSI/External Secrets/metrics-server that were already close to filling 2x t3.small (4 vCPU/4Gi total, minus per-node kubelet/system reservations). t3.medium (2 vCPU/4Gi each) gives real headroom instead of scheduling right at the edge. Extra cost over t3.small is a few dollars/month on Spot — trivial against the $200 credit for a cluster meant to be destroyed between sessions anyway."
  type        = list(string)
  default     = ["t3.medium"]
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

variable "slack_webhook_url" {
  description = "Slack Incoming Webhook URL, stored in AWS Secrets Manager and synced into the cluster for Alertmanager (runtime failure alerts: pod crash loops, node not ready, high resource usage, etc. — separate from the deploy-result Slack notification already sent directly from the GitHub Actions pipeline via the SLACK_WEBHOOK_URL GitHub secret). Reusing the same webhook URL for both is fine — set the same value here as `gh secret set SLACK_WEBHOOK_URL`. Pass via TF_VAR_slack_webhook_url or terraform.tfvars (gitignored), never commit a real value."
  type        = string
  default     = ""
  sensitive   = true
}

variable "grafana_domain" {
  description = "Hostname Grafana is served under (the ALB's DNS name, or a real domain once one is in front of it) — needed for Grafana's root_url/serve_from_sub_path config since it's routed through the same ALB at the /grafana path rather than getting its own load balancer. Circular on a fresh cluster like cors_allowed_origins above; update after first apply once the ALB hostname is known."
  type        = string
  default     = "localhost"
}
