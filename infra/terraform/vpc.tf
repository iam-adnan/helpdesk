module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = "10.42.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  public_subnets  = ["10.42.0.0/20", "10.42.16.0/20"]
  private_subnets = ["10.42.32.0/20", "10.42.48.0/20"]

  enable_nat_gateway = var.enable_nat_gateway
  single_nat_gateway = true # one NAT total when enabled, not one per AZ

  # REQUIRED when enable_nat_gateway = false. With no NAT, worker nodes sit in these
  # public subnets and a public IP is their only route out — to the EKS API, to Docker
  # Hub, to anything. The module defaults this to false, and EKS rejects the node group
  # outright rather than letting it come up broken:
  #
  #   Ec2SubnetInvalidConfiguration: One or more Amazon EC2 Subnets ... does not
  #   automatically assign public IP addresses to instances launched into it
  #
  # Cost is $0.005/hr per node IP (2 nodes = $0.01/hr), already counted in the design
  # doc's burn rate. Still far cheaper than the $33/mo NAT Gateway this avoids.
  #
  # Only the PUBLIC subnets get this. Private subnets stay as they are — when
  # enable_nat_gateway = true the nodes move there and reach the internet via NAT.
  map_public_ip_on_launch = true

  # Required tags for the AWS Load Balancer Controller to auto-discover subnets
  # for internet-facing (public) vs internal (private) ALBs/NLBs.
  public_subnet_tags = {
    "kubernetes.io/role/elb"                    = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  tags = {
    Project = "helpdesk-eks"
  }
}
