# The static IP the site is served on.
#
# Known at PLAN time — before the cluster, before any pod — which is what lets
# cors_allowed_origins and Grafana's root_url be computed in a single apply instead of
# the two-phase "apply, read the load balancer hostname, apply again" dance the original
# design required.
#
# There is no load balancer at all in the end: AWS rejects CreateLoadBalancer on this
# account, so the address is attached straight to a worker node and ingress-nginx runs as
# a hostNetwork DaemonSet (see below and addons.tf).

# The address is OWNED by the bootstrap stack (infra/terraform/bootstrap/main.tf) and
# only READ here, so `terraform destroy` of this stack releases the association but keeps
# the address itself. It used to be a resource in this stack, which meant every teardown
# returned it to AWS and the rebuild came up on a different IP — unusable for anything
# that has to keep pointing at it.
#
# Discovered by tag rather than via a remote-state data source, so the two stacks share
# only a naming convention and neither needs to read the other's state.
data "aws_eip" "ingress" {
  count = var.nlb_az_count

  filter {
    name   = "tag:Name"
    values = ["${var.cluster_name}-ingress-${count.index}"]
  }
}

# ---------------------------------------------------------------------------
# Attaching the Elastic IP directly to a worker node
# ---------------------------------------------------------------------------
#
# There is no load balancer in this design. AWS rejects CreateLoadBalancer on this
# account outright ("This AWS account currently does not support creating load
# balancers"), so the NLB the Elastic IP was meant to sit on can never exist. Instead
# ingress-nginx runs as a hostNetwork DaemonSet (addons.tf) and the address is bound
# straight to a node.

# Which node gets the address. The node group is ASG-managed so instance IDs are not
# known at plan time; they are looked up by the tag EKS puts on every managed node.
data "aws_instances" "nodes" {
  instance_tags = {
    "eks:cluster-name" = var.cluster_name
  }
  instance_state_names = ["running"]

  depends_on = [module.eks]
}

# An EKS node has MORE THAN ONE network interface — the VPC CNI attaches secondary ENIs
# to hand out pod IPs. Associating by instance_id is therefore rejected:
#
#   InvalidInstanceID: There are multiple interfaces attached to instance '...'.
#   Please specify an interface ID for the operation instead.
#
# The address has to go on the PRIMARY interface (device index 0) — that is the one
# carrying the node's own public IP and the one the internet reaches :80 through.
data "aws_network_interface" "node_primary" {
  filter {
    name   = "attachment.instance-id"
    values = [data.aws_instances.nodes.ids[0]]
  }
  filter {
    name   = "attachment.device-index"
    values = ["0"]
  }

  depends_on = [module.eks]
}

resource "aws_eip_association" "ingress" {
  allocation_id        = data.aws_eip.ingress[0].id
  network_interface_id = data.aws_network_interface.node_primary.id

  # Replaces the node's auto-assigned public IP with ours. Any node will do, since the
  # DaemonSet means all of them are listening on :80 — if this one is ever replaced, move
  # the association to a surviving node and traffic resumes with no rescheduling.
  depends_on = [module.eks]
}

# hostNetwork means traffic arrives on the NODE's security group, not a load balancer's.
# The EKS module's node security group allows no inbound from the internet by default, so
# without these two rules the Elastic IP answers nothing — connections just hang.
resource "aws_security_group_rule" "node_http" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = module.eks.node_security_group_id
  description       = "HTTP to the ingress-nginx hostNetwork DaemonSet"
}

resource "aws_security_group_rule" "node_https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = module.eks.node_security_group_id
  description       = "HTTPS to the ingress-nginx hostNetwork DaemonSet"
}

locals {
  # Retained so nlb_az_count keeps meaning something if a load balancer is reintroduced
  # once AWS permits one on this account.
  ingress_subnet_ids = slice(
    var.enable_nat_gateway ? module.vpc.private_subnets : module.vpc.public_subnets,
    0,
    var.nlb_az_count,
  )

  eip_allocation_ids = join(",", data.aws_eip.ingress[*].id)

  # The address quoted everywhere a single value is needed (Slack messages, CORS,
  # Grafana's root_url). With the default nlb_az_count = 1 this is the only address;
  # at 2 it is the first of two and the NLB's DNS name round-robins between them.
  website_ip = data.aws_eip.ingress[0].public_ip

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
