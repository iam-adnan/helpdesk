# helpdesk

## Running tests

Backend:
```bash
cd backend
pip install -r requirements.txt
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
export CELERY_TASK_ALWAYS_EAGER=True
pytest --cov
```

Frontend:
```bash
cd frontend
npm ci
npm test -- --coverage
```

## Infrastructure

EKS deployment infrastructure (Terraform) lives in `infra/terraform/`. See
`docs/superpowers/plans/2026-09-21-aws-eks-migration.md` for the full process,
cost plan, and tool list.

## Monitoring

Prometheus + Grafana + Alertmanager (`kube-prometheus-stack`) once deployed:
- Grafana: `http://<alb-hostname>/grafana`, user `admin`, password from
  `aws secretsmanager get-secret-value --secret-id helpdesk/grafana-admin-password --query SecretString --output text`
- Alertmanager posts runtime failures (pod crash loops, node not ready, high
  resource usage) to Slack — separate from the CI pipeline's own deploy-result
  Slack notification, same webhook/channel.
