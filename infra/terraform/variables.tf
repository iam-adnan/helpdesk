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
  description = "EKS control plane version. Verified against `aws eks describe-cluster-versions` on 2026-09-22: 1.36/1.35/1.34 are STANDARD_SUPPORT ($0.10/hr), 1.33/1.32/1.31 have already rolled into EXTENDED_SUPPORT ($0.60/hr — 6x). 1.31 was the original default here and would have hit that trap; re-check `endOfStandardSupportDate` before every apply, since these windows keep moving forward."
  type        = string
  default     = "1.36"
}

variable "enable_nat_gateway" {
  description = "true = worker nodes go in private subnets behind a NAT Gateway (~$33+/mo extra, closer to a real production pattern). false = nodes go in public subnets with a locked-down security group (default, cheapest — see the cost plan doc)."
  type        = bool
  default     = false
}

variable "node_instance_types" {
  description = <<-EOT
    Worker node instance type(s). MUST be Free-Tier-eligible on a Free Plan account —
    this is a hard restriction, not a billing preference. A non-eligible type is
    rejected at launch with:

      InvalidParameterCombination - The specified instance type is not eligible for
      Free Tier.

    t3.medium was the original default and is NOT eligible, which is why the node group
    sat in CREATING with zero instances. As with the Fleet quota, the cause appears only
    in the Auto Scaling group's scaling activities — never in the node group's health
    issues or in Terraform's output.

    Check the current list with:
      aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true

    In us-east-1 that is m7i-flex.large (2 vCPU/8Gi), c7i-flex.large (2 vCPU/4Gi),
    t3/t4g/t8i .small (2 vCPU/2Gi) and .micro (2 vCPU/1Gi).

    c7i-flex.large is the default: 4Gi matches what t3.medium would have given, which
    the monitoring stack (Prometheus, Grafana, Alertmanager, kube-state-metrics,
    node-exporter) needs on top of the app pods and the four controllers. The 2Gi
    .small types do not fit that comfortably; drop monitoring first if you switch to
    them to save money.
  EOT
  type        = list(string)
  default     = ["c7i-flex.large"]
}

variable "node_desired_size" {
  description = <<-EOT
    Nodes the group starts with. Cluster Autoscaler moves the ASG's desired capacity
    between node_min_size and node_max_size from here on.

    NOTE: a later `terraform apply` writes this value back to the ASG, so an apply that
    lands while the cluster is scaled out will scale it back in. Harmless — the
    autoscaler adds the node again within a minute if the load is still there — but it
    is why a scale-out can appear to "undo itself" right after a deploy.
  EOT
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = <<-EOT
    Floor for Cluster Autoscaler. Two, not one: the backend family is single-writer
    (SQLite on a ReadWriteOnce volume, see CLAUDE.md) so the app cannot survive on
    fewer nodes than the ingress DaemonSet needs to keep serving during a node
    replacement.
  EOT
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = <<-EOT
    Ceiling for Cluster Autoscaler. Three c7i-flex.large = 6 of this account's 8 vCPU
    quota, and each added node costs ~$0.085/hr for as long as it is up.
  EOT
  type        = number
  default     = 3
}

variable "node_capacity_type" {
  description = <<-EOT
    SPOT or ON_DEMAND. Defaults to ON_DEMAND, which is NOT the cheap option — it is the
    one that works on a new account.

    SPOT was the original default (70-90% cheaper) and it failed against this account.
    An EKS managed node group with capacity_type = SPOT provisions through EC2 Fleet,
    and a new AWS account's Fleet Request quota is effectively zero, so every launch is
    rejected with:

      You've reached your quota for maximum Fleet Requests for this account.

    The failure mode is nasty: the node group reports CREATING for 20+ minutes with zero
    instances rather than failing fast, and the cause only appears in the Auto Scaling
    group's scaling activities, not in the node group's own health issues or in any
    Terraform output. Meanwhile the control plane bills at $0.10/hr.

    Cost of the switch: t3.medium is ~$0.0416/hr on demand vs ~$0.0165/hr spot, so 2
    nodes go from $0.033/hr to $0.083/hr — about +$1.20/day. Set back to SPOT once a
    Fleet Request quota increase has been granted (Service Quotas -> EC2).
  EOT
  type        = string
  default     = "ON_DEMAND"

  validation {
    condition     = contains(["SPOT", "ON_DEMAND"], var.node_capacity_type)
    error_message = "node_capacity_type must be SPOT or ON_DEMAND."
  }
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

# NOTE: `cors_allowed_origins` and `grafana_domain` used to live here, both carrying a
# warning that they were circular on a fresh cluster — the ALB hostname didn't exist
# until after apply, so both needed a second `terraform apply` to fix up. That is no
# longer true. The site address is now an Elastic IP allocated by Terraform itself
# (static_ip.tf), so it is known at plan time and both values are derived in
# `locals` instead. Override with `site_domain` below if a real domain is in play.

# ---------------------------------------------------------------------------
# Grafana Cloud
# ---------------------------------------------------------------------------
#
# Metrics are shipped OUT of the cluster so they survive `terraform destroy`. In-cluster
# Grafana ran with persistence disabled, so every teardown wiped all history — which, on
# a cluster this project rebuilds constantly, meant monitoring was effectively write-only.

variable "grafana_cloud_enabled" {
  description = "Ship Prometheus metrics to Grafana Cloud via remote_write and disable the in-cluster Grafana. Set false to go back to a self-contained monitoring stack."
  type        = bool
  default     = true
}

variable "grafana_cloud_prometheus_url" {
  description = "Grafana Cloud Prometheus remote_write endpoint, e.g. https://prometheus-prod-67-prod-us-west-0.grafana.net/api/prom/push. Stack-specific — copy it from the stack's Prometheus 'Send Metrics' page, do not guess the region."
  type        = string
  default     = ""
}

variable "grafana_cloud_username" {
  description = "Grafana Cloud Prometheus instance ID — the numeric 'username' on the same page. NOT your account email."
  type        = string
  default     = ""
}

variable "grafana_cloud_token" {
  description = "Grafana Cloud Access Policy token (glc_...) with the metrics:write scope. An account PASSWORD cannot be used here — remote_write authenticates with a token only. Pass via TF_VAR_grafana_cloud_token; stored in Secrets Manager, never in the repo."
  type        = string
  default     = ""
  sensitive   = true
}

variable "site_domain" {
  description = "Optional real domain pointed at the static IP. Left empty (the default), the Elastic IP is used directly for CORS origins and Grafana's root_url — which is correct while the site is served over plain HTTP on an IP. Set this once a domain and TLS are in front of it."
  type        = string
  default     = ""
}

variable "nlb_az_count" {
  description = "Number of availability zones (and therefore Elastic IPs) the ingress NLB spans. An NLB takes exactly one EIP per subnet, so 1 (the default) yields exactly ONE static IP — simplest to share and cheapest. 2 yields two IPs and a genuinely HA load balancer for an extra ~$0.005/hr, at the cost of making \"the website IP\" ambiguous. Must not exceed the number of subnets the VPC has (2)."
  type        = number
  default     = 1

  validation {
    condition     = var.nlb_az_count >= 1 && var.nlb_az_count <= 2
    error_message = "nlb_az_count must be 1 or 2 — the VPC in vpc.tf defines exactly two public and two private subnets."
  }
}

variable "slack_webhook_url" {
  description = "Slack Incoming Webhook URL, stored in AWS Secrets Manager and synced into the cluster for Alertmanager (runtime failure alerts: pod crash loops, node not ready, high resource usage, etc. — separate from the deploy-result Slack notification already sent directly from the GitHub Actions pipeline via the SLACK_WEBHOOK_URL GitHub secret). Reusing the same webhook URL for both is fine — set the same value here as `gh secret set SLACK_WEBHOOK_URL`. Pass via TF_VAR_slack_webhook_url or terraform.tfvars (gitignored), never commit a real value."
  type        = string
  default     = ""
  sensitive   = true
}

