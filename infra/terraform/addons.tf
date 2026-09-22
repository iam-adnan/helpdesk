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

  # wait = true matters here specifically. This chart installs a mutating webhook, and
  # `depends_on` only guarantees Helm returned — not that the webhook is actually
  # serving. The ingress-nginx Service below is annotated for an NLB with our Elastic
  # IPs; if it is created while the webhook is still coming up, the annotations go
  # unprocessed and Kubernetes falls back to the in-tree provider, which silently
  # produces a classic ELB with AWS-assigned addresses. That failure looks like a
  # successful apply and is only caught later by deploy.sh's EIP-binding check.
  wait    = true
  timeout = 600

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
      # DaemonSet + hostNetwork instead of a LoadBalancer Service.
      #
      # The original design put an NLB in front, carrying the Elastic IP. That is
      # impossible on this account: every CreateLoadBalancer call is rejected with
      #
      #   OperationNotPermitted: This AWS account currently does not support creating
      #   load balancers. For more information, please contact AWS Support.
      #
      # so the Service sat <pending> forever and the Elastic IP never bound to anything.
      # This avoids the ELB API entirely — ingress-nginx binds :80/:443 directly in each
      # node's own network namespace, and the Elastic IP is attached straight to a node
      # (see static_ip.tf). Traffic path becomes:
      #
      #   client -> Elastic IP -> node :80 -> ingress-nginx -> Service -> pod
      #
      # DaemonSet rather than a pinned single replica: every node listens on :80, so the
      # Elastic IP can be moved between nodes without rescheduling anything. With
      # hostNetwork only one such pod can exist per node anyway, which is exactly what a
      # DaemonSet gives.
      #
      # Cost: this REMOVES the load balancer's ~$0.023/hr. Tradeoff: no LB-level health
      # checking or failover — if the node holding the Elastic IP goes away, the address
      # must be reattached to the surviving node.
      kind        = "DaemonSet"
      hostNetwork = true

      # Required with hostNetwork: without it the pod inherits the node's resolv.conf and
      # cannot resolve in-cluster Services, so every proxy_pass to backend/frontend fails.
      dnsPolicy = "ClusterFirstWithHostNet"

      # ClusterIP, not LoadBalancer — nothing should ask AWS for an ELB. The Service still
      # exists because the chart's admission webhook needs one.
      service = {
        type = "ClusterIP"
      }

      ingressClassResource = {
        name    = "nginx"
        enabled = true
        # Default class, so an Ingress with neither ingressClassName nor an annotation
        # still gets picked up rather than silently sitting unrouted.
        default = true
      }

      # The ONLY source of HTTP-level telemetry in this stack. The Django app carries no
      # instrumentation (django-prometheus is not in backend/requirements.txt), and the
      # prometheus.io/scrape annotations on the backend Deployment point at :8000, which
      # serves the app rather than a metrics endpoint — so they scrape nothing useful.
      #
      # ingress-nginx sits in front of every request, so enabling its exporter yields
      # request rate, status-code breakdown and latency percentiles for the whole site
      # without touching application code. serviceMonitor is what makes
      # kube-prometheus-stack actually discover it; metrics.enabled alone only opens the
      # port.
      metrics = {
        enabled = true
        serviceMonitor = {
          enabled = true
          # The Prometheus CR selects ServiceMonitors by release label.
          additionalLabels = {
            release = "kube-prometheus-stack"
          }
        }
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

  # No dependency on the Elastic IP any more: it is owned by the bootstrap stack and
  # merely read here, so it already exists before this stack runs at all.
  depends_on = [
    module.eks,
    helm_release.aws_load_balancer_controller,
  ]
}
