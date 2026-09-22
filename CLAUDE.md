# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (Django, in `backend/`)

```bash
pip install -r requirements.txt
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
export CELERY_TASK_ALWAYS_EAGER=True   # runs .delay() calls synchronously, no Redis needed for tests

pytest --cov                              # full suite with coverage
pytest accounts/tests.py -v               # single app
pytest accounts/tests.py::UserModelTests::test_first_user_becomes_admin -v   # single test
```
`pytest.ini` sets `--reuse-db --nomigrations` — the test DB is built straight from models, not by replaying migrations.

Local dev server (Django, not via Docker):
```bash
python manage.py migrate
python manage.py runserver
```

### Frontend (Next.js, in `frontend/`)

```bash
npm ci
npm run dev              # dev server
npm run build             # production build
npm test                  # Jest
npm test -- --coverage
npx next lint             # no custom .eslintrc — uses Next's built-in config
```

### Full stack locally

```bash
./start.sh                 # docker compose build --no-cache && up -d
docker compose logs -f
docker compose down
```
First account registered through the UI with an `@mindstormstudios.com` email automatically becomes admin (`accounts.models.User.save()` — the very first `User` row in the whole table, not per-role).

⚠️ `fix-migrations.sh` is a one-off rescue script from an earlier incident — it **overwrites `docker-compose.yml` with a hardcoded heredoc** and assumes a `~/mindstorm-helpdesk` checkout path. Don't run it as a routine command; it will clobber the current `docker-compose.yml`.

### Infrastructure (Terraform, in `infra/terraform/`)

```bash
export AWS_PROFILE=helpdesk-eks
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```
See `docs/superpowers/plans/2026-09-21-aws-eks-migration.md` for the full process, cost plan, and a live deployment log against the actual AWS account.

## Architecture

**Two independent deploy targets exist in this repo, don't conflate them:**
- `k8s/base/all-in-one.yaml` — plain manifest, was used for a k3s-on-a-single-EC2-host deployment (now retired).
- `k8s/eks/` — a Kustomize **overlay** on top of `k8s/base/` (`resources: [../base, ...]`), adapted for EKS: ALB `Ingress` instead of the old nginx NodePort, `gp3` StorageClass patches (EKS ships no default EBS StorageClass since k8s 1.23+), the nginx Deployment/Service deleted via a `$patch: delete`, and `ExternalSecret`/`ClusterSecretStore` resources replacing a hardcoded plaintext `Secret`.

**Runtime container images are distroless** (`Dockerfile.backend`, `Dockerfile.frontend`) — multi-stage builds whose final stage has no shell, no package manager. This has real consequences for how commands are wired into `k8s/base/all-in-one.yaml`: every container command must be exec-form (`["python3", "manage.py", "migrate", "--noinput"]`, not `sh -c "a && b"`), and `python3`/no bare `python`. `docker-compose.yml`'s backend-family services (`backend`, `celery`, `slack-bot`) build against the Dockerfile's `builder` stage specifically (`target: builder`) since local dev's multi-step shell commands need a shell the distroless runtime stage doesn't have.

**Secrets have two entirely separate delivery paths — check which one before assuming:**
1. **AWS Secrets Manager + External Secrets Operator** (`infra/terraform/secrets.tf`, `k8s/eks/externalsecret-*.yaml`) — for the app's own runtime secrets (`SECRET_KEY`, `CORS_ALLOWED_ORIGINS`) and the monitoring stack's (Grafana admin password, Alertmanager's Slack webhook). ESO syncs these into ordinary Kubernetes `Secret` objects at the names the Deployments already reference via `envFrom`/`secretRef` — no Deployment spec changes needed when the secret's source changes.
2. **The Django admin settings panel** (`settings_manager.AppSetting`, a DB table read via `AppSetting.get(key)`) — for anything an admin might reconfigure at runtime without a redeploy: the Slack bot's `slack_bot_token`/`slack_app_token`, SMTP creds, the Anthropic API key. **Not** environment variables, **not** GitHub/Terraform secrets. `backend/slack_bot.py` blocks on startup (`wait_for_settings()`) until these are set through the admin UI.

**Two Slack integrations, also don't conflate:**
- `backend/slack_bot.py` — the actual, deployed ticket-creation bot. Socket Mode (outbound connection, no inbound webhook needed), scopes/manifest in `infra/slack/manifest.json`.
- CI/CD deploy notifications and Alertmanager runtime alerts — a Slack **Incoming Webhook**, bound to one fixed channel at creation time (the `channel` field in a message payload does not override this for app-based webhooks). GitHub secret `SLACK_WEBHOOK_URL` and Terraform var `TF_VAR_slack_webhook_url` are the same URL, two different senders.
- `backend/slack_bridge.py` and `backend/integrations/slack_views.py` (HTTP-based alternatives to Socket Mode) are **not wired into any deployment** — `docker-compose.yml`/`k8s/` never run them, and `nginx.conf`'s `/slack/` proxy target (`slack-bridge:9000`) doesn't exist as a service anywhere. Leftover from an earlier architecture; don't build on them without first confirming that's actually intended.

**Backend apps are single-writer by design**: every Deployment in `k8s/base/all-in-one.yaml` is `replicas: 1` because the database is **SQLite on a PersistentVolume**, not a server — there's no safe multi-writer story. Don't scale `backend` beyond 1 replica without first migrating off SQLite.

**First-user-becomes-admin** and **email-domain-gated registration** (`ALLOWED_EMAIL_DOMAIN` in `backend/helpdesk/settings.py`, currently `mindstormstudios.com`) are both enforced in `accounts` — model-level for the former (`User.save()`), serializer-level for the latter (`UserCreateSerializer.validate_email`). Both are easy to break silently if `accounts/models.py`/`serializers.py` are touched without re-running `accounts/tests.py`.

**CI/CD** (`.github/workflows/cicd.yml`): tests → SonarCloud → Trivy → build/push to **Docker Hub** (not ECR) → deploy to EKS via GitHub OIDC (no static AWS keys) → health check → Slack/email notify. The deploy/health-check/notify tail is gated behind the repo variable `EKS_DEPLOY_ENABLED == 'true'` — when it's unset/false, those jobs intentionally no-op rather than fail, so pushes to `main` don't break the pipeline before the AWS side is ready.
