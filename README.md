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
