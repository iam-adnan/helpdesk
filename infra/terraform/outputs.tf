output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "region" {
  value = var.aws_region
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "github_deploy_role_arn" {
  description = "Set as the GitHub Actions repo secret AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_deploy.arn
}

output "lb_controller_role_arn" {
  value = module.lb_controller_irsa.iam_role_arn
}

output "ebs_csi_role_arn" {
  value = module.ebs_csi_irsa.iam_role_arn
}

output "external_secrets_role_arn" {
  value = module.external_secrets_irsa.iam_role_arn
}

output "secrets_manager_secret_arns" {
  value = {
    django_secret_key      = aws_secretsmanager_secret.django_secret_key.arn
    cors_allowed_origins   = aws_secretsmanager_secret.cors_allowed_origins.arn
    dockerhub_credentials  = aws_secretsmanager_secret.dockerhub_credentials.arn
    grafana_admin_password = aws_secretsmanager_secret.grafana_admin_password.arn
    slack_webhook_url      = aws_secretsmanager_secret.slack_webhook_url.arn
  }
}

output "kubeconfig_command" {
  value = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.aws_region}"
}

output "grafana_url" {
  description = "Once the ALB Ingress has a hostname (kubectl -n helpdesk get ingress helpdesk-ingress), Grafana is at http://<that-hostname>/grafana — login is 'admin' + `aws secretsmanager get-secret-value --secret-id helpdesk/grafana-admin-password --query SecretString --output text`."
  value       = "http://${var.grafana_domain}/grafana"
}
