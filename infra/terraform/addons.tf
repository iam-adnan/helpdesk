resource "aws_eks_addon" "ebs_csi" {
  cluster_name             = module.eks.cluster_name
  addon_name               = "aws-ebs-csi-driver"
  service_account_role_arn = module.ebs_csi_irsa.iam_role_arn

  depends_on = [module.eks]
}

resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"

  set {
    name  = "clusterName"
    value = module.eks.cluster_name
  }
  set {
    name  = "serviceAccount.create"
    value = "true"
  }
  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.lb_controller_irsa.iam_role_arn
  }

  depends_on = [module.eks]
}

resource "helm_release" "metrics_server" {
  name       = "metrics-server"
  repository = "https://kubernetes-sigs.github.io/metrics-server/"
  chart      = "metrics-server"
  namespace  = "kube-system"

  depends_on = [module.eks]
}

resource "kubernetes_namespace" "external_secrets" {
  metadata {
    name = "external-secrets"
  }

  depends_on = [module.eks]
}

resource "helm_release" "external_secrets" {
  name       = "external-secrets"
  repository = "https://charts.external-secrets.io"
  chart      = "external-secrets"
  namespace  = kubernetes_namespace.external_secrets.metadata[0].name

  set {
    name  = "serviceAccount.name"
    value = "external-secrets"
  }
  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = module.external_secrets_irsa.iam_role_arn
  }

  depends_on = [module.eks, kubernetes_namespace.external_secrets]
}

# ---------------------------------------------------------------------------
# ingress-nginx — the L7 router behind the static-IP NLB
# ---------------------------------------------------------------------------
#
# Replaces the ALB Ingress as the thing that routes /api -> backend, / -> frontend and
# /grafana -> Grafana. The ALB had to go because an ALB cannot carry an Elastic IP
# (design doc §4.1); an NLB can, but an NLB is L4 and cannot path-route on its own, so
# something in-cluster has to do the L7 work. That is this.
#
# helm_release.aws_load_balancer_controller above is NOT removed — it is precisely what
# turns the annotations below into a real NLB with our Elastic IPs attached. Deleting it
# would leave this Service stuck in <pending> forever.

resource "kubernetes_namespace" "ingress_nginx" {
  metadata {
    name = "ingress-nginx"
  }

  depends_on = [module.eks]
}

locals {
  ingress_nginx_values = {
    controller = {
      # One replica, matching every other Deployment in this project. The node budget
      # is 2x t3.medium and the Spot vCPU quota is 5 with 4 already requested, so there
      # is no room to grow the cluster if this turns out tight.
      replicaCount = 1

      service = {
        type = "LoadBalancer"
        annotations = {
          # "external" selects the AWS Load Balancer Controller rather than the legacy
          # in-tree cloud provider. The in-tree one ignores eip-allocations entirely,
          # which would silently produce an NLB with AWS-assigned addresses — the exact
          # failure this whole change exists to avoid.
          "service.beta.kubernetes.io/aws-load-balancer-type"            = "external"
          "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type" = "ip"
          "service.beta.kubernetes.io/aws-load-balancer-scheme"          = "internet-facing"

          # The static IPs, straight out of Terraform state. One allocation ID per
          # subnet, and the counts must match exactly or the NLB fails to provision.
          "service.beta.kubernetes.io/aws-load-balancer-eip-allocations" = local.eip_allocation_ids
          "service.beta.kubernetes.io/aws-load-balancer-subnets"         = join(",", local.ingress_subnet_ids)

          # Required at the default nlb_az_count = 1: the NLB lives in ONE subnet but
          # pods are spread across both AZs, so without cross-zone it can only reach
          # roughly half of them and the other half's traffic blackholes. Bills
          # $0.01/GB inter-AZ, which is immaterial at this traffic level.
          "service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled" = "true"
        }
      }

      ingressClassResource = {
        name    = "nginx"
        enabled = true
        # Default class, so an Ingress with neither ingressClassName nor an annotation
        # still gets picked up rather than silently sitting unrouted.
        default = true
      }

      resources = {
        requests = { cpu = "100m", memory = "128Mi" }
        limits   = { cpu = "500m", memory = "512Mi" }
      }
    }
  }
}

resource "helm_release" "ingress_nginx" {
  name       = "ingress-nginx"
  repository = "https://kubernetes.github.io/ingress-nginx"
  chart      = "ingress-nginx"
  namespace  = kubernetes_namespace.ingress_nginx.metadata[0].name

  values = [yamlencode(local.ingress_nginx_values)]

  # Waits for the NLB to actually come up rather than returning as soon as the chart is
  # installed — so `terraform apply` finishing means the site is genuinely reachable,
  # which is what the Slack success message then claims.
  wait    = true
  timeout = 600

  depends_on = [
    module.eks,
    helm_release.aws_load_balancer_controller,
    aws_eip.ingress,
  ]
}
