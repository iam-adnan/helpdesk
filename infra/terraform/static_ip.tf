# The static IP the site is served on.
#
# Why this exists at all: the AWS Load Balancer Controller provisions an ALB from the
# Ingress resources in k8s/eks/, and an ALB has NO static IP — AWS exposes it only as a
# DNS name whose addresses rotate. Elastic IP attachment is supported on Network Load
# Balancers only. So the load balancer type had to change; see the design doc §4.
#
# The addresses are allocated by Terraform, which means they are known at PLAN time —
# before the cluster, before any pod. That is what lets cors_allowed_origins and
# grafana_domain be computed in a single apply instead of the two-phase
# "apply, read the ALB hostname, apply again" dance the old variables.tf described.

resource "aws_eip" "ingress" {
  count  = var.nlb_az_count
  domain = "vpc"

  tags = {
    Name    = "${var.cluster_name}-ingress-${count.index}"
    Project = "helpdesk-eks"
    # Read by .github/workflows/cicd.yml to find the site address without needing
    # access to Terraform state or outputs.
    Role = "ingress-static-ip"
  }
}

locals {
  # An NLB takes one Elastic IP per subnet it attaches to, so nlb_az_count controls
  # both the number of IPs and the number of AZs. Default 1 => exactly one static IP.
  ingress_subnet_ids = slice(
    var.enable_nat_gateway ? module.vpc.private_subnets : module.vpc.public_subnets,
    0,
    var.nlb_az_count,
  )

  eip_allocation_ids = join(",", aws_eip.ingress[*].id)

  # The address quoted everywhere a single value is needed (Slack messages, CORS,
  # Grafana's root_url). With the default nlb_az_count = 1 this is the only address;
  # at 2 it is the first of two and the NLB's DNS name round-robins between them.
  website_ip = aws_eip.ingress[0].public_ip

  # A real domain wins over the raw IP when one is configured, so turning on DNS/TLS
  # later is a one-variable change rather than a hunt through every reference.
  site_host   = var.site_domain != "" ? var.site_domain : local.website_ip
  website_url = "http://${local.site_host}"

  # Both frontend origins the browser might send. Django's CORS_ALLOWED_ORIGINS needs
  # the scheme, and localhost stays in the list so a developer running the frontend
  # locally against this cluster's API still works.
  cors_allowed_origins = join(",", [
    local.website_url,
    "http://localhost:3000",
    "http://localhost",
  ])
}
