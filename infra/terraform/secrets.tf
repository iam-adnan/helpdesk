# AWS Secrets Manager is the source of truth for every runtime secret the app needs.
# Nothing here is committed to git in plaintext — this replaces the hardcoded
# `Secret` object that used to live directly in k8s/all-in-one.yaml (SECRET_KEY was
# literally committed as "change-this-to-a-long-random-string-in-production-64-chars").
# External Secrets Operator (installed in addons.tf, read access via irsa.tf) syncs
# these into real Kubernetes Secret objects at the names the Deployments already
# reference via envFrom/secretRef — see k8s/eks/externalsecret-*.yaml.

resource "random_password" "django_secret_key" {
  length  = 64
  special = true
}

resource "aws_secretsmanager_secret" "django_secret_key" {
  name        = "helpdesk/django-secret-key"
  description = "Django SECRET_KEY for the helpdesk backend — synced into the cluster by External Secrets Operator."
}

resource "aws_secretsmanager_secret_version" "django_secret_key" {
  secret_id     = aws_secretsmanager_secret.django_secret_key.id
  secret_string = random_password.django_secret_key.result
}

resource "aws_secretsmanager_secret" "cors_allowed_origins" {
  name        = "helpdesk/cors-allowed-origins"
  description = "CORS_ALLOWED_ORIGINS for the helpdesk backend. Update the value after the ALB's hostname is known (see variables.tf's cors_allowed_origins description)."
}

resource "aws_secretsmanager_secret_version" "cors_allowed_origins" {
  secret_id     = aws_secretsmanager_secret.cors_allowed_origins.id
  secret_string = var.cors_allowed_origins
}

# Only actually consumed if the Docker Hub repos are private (see
# k8s/eks/externalsecret-dockerhub.yaml) — stored either way so the ExternalSecret
# has something to sync from without conditionally wiring Terraform resources.
resource "aws_secretsmanager_secret" "dockerhub_credentials" {
  name        = "helpdesk/dockerhub-credentials"
  description = "Docker Hub pull credentials, only needed if the helpdesk-backend/helpdesk-frontend repos are private."
}

resource "aws_secretsmanager_secret_version" "dockerhub_credentials" {
  secret_id = aws_secretsmanager_secret.dockerhub_credentials.id
  secret_string = jsonencode({
    username = var.dockerhub_username
    password = var.dockerhub_token
  })
}

# ---- Monitoring stack secrets (kube-prometheus-stack, see monitoring.tf) ----

resource "random_password" "grafana_admin_password" {
  length  = 24
  special = false # kept alphanumeric so it's easy to paste into a browser login form
}

resource "aws_secretsmanager_secret" "grafana_admin_password" {
  name        = "helpdesk/grafana-admin-password"
  description = "Grafana admin password — synced into the monitoring namespace by External Secrets Operator. Username is fixed as 'admin' (see externalsecret-grafana.yaml)."
}

resource "aws_secretsmanager_secret_version" "grafana_admin_password" {
  secret_id     = aws_secretsmanager_secret.grafana_admin_password.id
  secret_string = random_password.grafana_admin_password.result
}

# Same webhook URL the GitHub Actions pipeline already uses for deploy-result
# notifications (as the SLACK_WEBHOOK_URL GitHub secret) — stored here too so
# Alertmanager can post RUNTIME failure alerts (pod crash loops, node not ready,
# high resource usage) to the same Slack channel. Two different delivery paths,
# same destination.
resource "aws_secretsmanager_secret" "slack_webhook_url" {
  name        = "helpdesk/slack-webhook-url"
  description = "Slack Incoming Webhook URL for Alertmanager's runtime-failure notifications."
}

resource "aws_secretsmanager_secret_version" "slack_webhook_url" {
  secret_id     = aws_secretsmanager_secret.slack_webhook_url.id
  secret_string = var.slack_webhook_url
}
