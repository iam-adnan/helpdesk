# kube-prometheus-stack: Prometheus + Grafana + Alertmanager + kube-state-metrics +
# a node-exporter DaemonSet (per-node CPU/memory/disk/network metrics) + the
# Prometheus Operator, all as one chart. Gives node health and cluster-wide stats
# out of the box (the chart ships default Grafana dashboards and a large default
# Prometheus alerting rule set — KubeNodeNotReady, KubePodCrashLooping,
# KubeDeploymentReplicasMismatch, node CPU/memory/disk pressure, etc. — no need to
# hand-write those). Alertmanager routes everything to Slack; see
# k8s/eks/externalsecret-alertmanager-slack.yaml for the webhook wiring.
#
# Ordering note: this Helm release does NOT depend on the ExternalSecrets in
# k8s/eks/ (grafana-admin-credentials, alertmanager-slack-webhook) existing yet —
# `terraform apply` will succeed and create the chart's resources regardless. If
# `kubectl apply -k k8s/eks/` (which creates those secrets) hasn't run yet, the
# Grafana/Alertmanager pods will just sit retrying "FailedMount" until the secrets
# show up, then start automatically — no manual restart needed. Apply order that
# avoids the wait entirely: `terraform apply` first (creates the AWS secrets +
# IRSA + ESO itself), then `kubectl apply -k k8s/eks/` (creates the synced k8s
# Secrets), then this Helm release's pods come up clean on the first try.

resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"
  }

  depends_on = [module.eks]
}

locals {
  monitoring_values = {
    fullnameOverride = "kube-prometheus-stack"

    # In-cluster Grafana is OFF when Grafana Cloud is in use — dashboards live at the
    # Cloud stack instead. This is not just deduplication: the in-cluster Grafana ran with
    # persistence disabled (see below), so it lost every dashboard and datasource on each
    # teardown. Turning it off also frees ~180Mi on nodes that only have 4Gi each.
    grafana = {
      enabled = !var.grafana_cloud_enabled

      admin = {
        existingSecret = "grafana-admin-credentials"
        userKey        = "admin-user"
        passwordKey    = "admin-password"
      }
      # No separate LoadBalancer/Ingress for Grafana — routed through the app's own
      # ALB at /grafana (k8s/eks/ingress.yaml) so this doesn't provision (and pay
      # for) a second load balancer.
      ingress = {
        enabled = false
      }
      "grafana.ini" = {
        server = {
          domain              = local.site_host
          root_url            = "${local.website_url}/grafana"
          serve_from_sub_path = true
        }
      }
      resources = {
        requests = { cpu = "50m", memory = "128Mi" }
        limits   = { cpu = "200m", memory = "256Mi" }
      }
      # No persistence: this is a short-lived, destroy-between-sessions cluster
      # (see the cost plan doc) and every dashboard here is chart-provisioned from
      # ConfigMaps anyway, not hand-built — nothing meaningful to lose on restart.
      persistence = {
        enabled = false
      }
    }

    prometheus = {
      prometheusSpec = {
        # Ship everything to Grafana Cloud. This is what makes metrics outlive the
        # cluster — the local TSDB becomes a short buffer, not the system of record.
        #
        # Grafana Cloud cannot scrape a private EKS cluster, so something in-cluster has
        # to push. Prometheus is already here and already scraping, so remote_write is the
        # smallest change that achieves it; a separate Grafana Alloy agent would be
        # lighter but would duplicate the scrape config that kube-prometheus-stack
        # generates from ServiceMonitors.
        remoteWrite = var.grafana_cloud_enabled ? [{
          url = var.grafana_cloud_prometheus_url
          basicAuth = {
            username = {
              name = "grafana-cloud-credentials"
              key  = "username"
            }
            password = {
              name = "grafana-cloud-credentials"
              key  = "password"
            }
          }
        }] : []

        # 6h rather than 3d once Cloud holds the history — local storage only needs to
        # cover a remote_write outage, not act as the archive.
        retention = var.grafana_cloud_enabled ? "6h" : "3d"
        resources = {
          requests = { cpu = "200m", memory = "512Mi" }
          limits   = { cpu = "500m", memory = "1Gi" }
        }
        storageSpec = {
          volumeClaimTemplate = {
            spec = {
              storageClassName = "gp3"
              accessModes      = ["ReadWriteOnce"]
              resources = {
                requests = { storage = "10Gi" }
              }
            }
          }
        }
      }
    }

    alertmanager = {
      alertmanagerSpec = {
        resources = {
          requests = { cpu = "50m", memory = "64Mi" }
          limits   = { cpu = "100m", memory = "128Mi" }
        }
        # Mounts the k8s Secret External Secrets Operator syncs from AWS Secrets
        # Manager (helpdesk/slack-webhook-url) at
        # /etc/alertmanager/secrets/alertmanager-slack-webhook/ — referenced below
        # via api_url_file rather than putting the raw webhook URL in this Helm
        # values block (which would otherwise land in plaintext in the release's
        # stored values / this Terraform state).
        secrets = ["alertmanager-slack-webhook"]
      }
      config = {
        global = {
          resolve_timeout = "5m"
        }
        route = {
          receiver        = "slack"
          group_by        = ["alertname", "namespace"]
          group_wait      = "30s"
          group_interval  = "5m"
          repeat_interval = "3h"
        }
        receivers = [
          {
            name = "slack"
            slack_configs = [
              {
                api_url_file = "/etc/alertmanager/secrets/alertmanager-slack-webhook/slack_url"
                # No `channel` override here on purpose: a Slack app's Incoming Webhook
                # is bound to one fixed channel, chosen when the webhook is generated
                # (Slack Apps -> Incoming Webhooks -> Add New Webhook to Workspace ->
                # pick a channel) — the `channel` field in the payload is ignored for
                # this kind of webhook, unlike the deprecated workspace-wide "custom
                # integration" webhooks that used to honor it. Whatever channel you
                # picked when creating the webhook is where these alerts land.
                send_resolved = true
                title         = "{{ .CommonAnnotations.summary }}"
                text          = "{{ range .Alerts }}{{ .Annotations.description }}\n{{ end }}"
              }
            ]
          }
        ]
      }
    }

    kubeStateMetrics = {
      resources = {
        requests = { cpu = "20m", memory = "32Mi" }
        limits   = { cpu = "50m", memory = "64Mi" }
      }
    }

    "prometheus-node-exporter" = {
      resources = {
        requests = { cpu = "20m", memory = "16Mi" }
        limits   = { cpu = "50m", memory = "32Mi" }
      }
    }

    prometheusOperator = {
      resources = {
        requests = { cpu = "50m", memory = "64Mi" }
        limits   = { cpu = "100m", memory = "128Mi" }
      }
    }
  }
}

resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  # Check for a newer chart release (https://artifacthub.io/packages/helm/prometheus-community/kube-prometheus-stack)
  # before applying — pinned to a specific version rather than left floating so a
  # `terraform apply` a month from now doesn't silently pull a breaking change.
  version = "91.4.1"

  values = [yamlencode(local.monitoring_values)]

  # wait = false is REQUIRED here, not an optimisation.
  #
  # The Grafana pod mounts `grafana-admin-credentials`, a Secret that External Secrets
  # Operator only creates once `kubectl apply -k k8s/eks/` has run — which happens AFTER
  # this apply, by design (the ordering note at the top of this file says so). With the
  # provider's default wait, Terraform blocks on a Deployment that cannot become ready
  # yet, burns the full timeout, and then fails the whole apply with:
  #
  #   Warning: Helm release "" was created but has a failed status.
  #   Error: context deadline exceeded
  #
  # ...after which the release is left in a `failed` state that blocks the next apply
  # too. Everything else in the chart (Prometheus, Alertmanager, kube-state-metrics,
  # node-exporter, the operator) comes up fine; Grafana starts on its own the moment the
  # secret appears, with no restart needed.
  wait = false

  depends_on = [
    module.eks,
    aws_eks_addon.ebs_csi, # Prometheus's PVC needs the gp3 StorageClass this backs
    kubernetes_storage_class.gp3,
  ]
}
