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

Driven by scripts, not raw `terraform` commands — they carry the ordered teardown and the Slack notifications, and raw `terraform destroy` **orphans billable resources** (see below).

```bash
cp infra/terraform/terraform.env.example infra/terraform/terraform.env   # fill it in (gitignored)

./infra/scripts/bootstrap.sh    # ONCE, as account root: IAM user, S3 state bucket, OIDC provider, budget
./infra/scripts/deploy.sh       # cluster + static IP + addons, then the app manifests
./infra/scripts/destroy.sh      # ordered teardown + "is anything still billing?" audit
```

`terraform.env` is the single config surface (there is no `terraform.tfvars`). `BOOTSTRAP_AWS_PROFILE` holds root keys and is used only by `bootstrap.sh`; `AWS_PROFILE` is the `terraform-eks-admin` profile bootstrap writes, and everything else runs as that.

**Two stacks, and the split matters.** `infra/terraform/bootstrap/` holds what must survive a destroy — the IAM user, the S3 state bucket, the GitHub OIDC provider, the CI infra role, the budget. If any of those lived in the main stack, `terraform destroy` would delete the identity running it, fail partway, and strand resources that keep billing.

**Never run a bare `terraform destroy`.** EBS volumes (the `sqlite-pvc`/`media-pvc` claims and Prometheus's 10Gi) and the NLB are created from inside the cluster, so deleting the cluster first orphans them — and an orphaned load balancer additionally blocks VPC deletion by holding ENIs. `destroy.sh` drains them first, then audits EKS/ELB/EIP/EBS/NAT/EC2 counts, because "destroy reported success" and "nothing is billing" are different claims.

CI equivalents: `.github/workflows/infra.yml` (`workflow_dispatch` only — plan/apply/destroy, destroy needs `DESTROY` typed in). Deliberately not on `push`.

**When an EKS node group hangs in `CREATING` with zero instances, the real error is in the Auto Scaling group — nowhere else.** This cost three failed deploys on 2026-09-22. The node group's own `health.issues` was empty, and Terraform printed nothing but "Still creating..." for 12+ minutes each time. Go straight to:

```bash
ASG=$(aws autoscaling describe-auto-scaling-groups \
  --query "AutoScalingGroups[?contains(Tags[?Key=='eks:cluster-name'].Value,'helpdesk-eks')].AutoScalingGroupName|[0]" --output text)
aws autoscaling describe-scaling-activities --auto-scaling-group-name "$ASG" \
  --max-items 3 --query 'Activities[].StatusMessage' --output text
```

The three causes it surfaced, all now fixed but all invisible to `terraform plan`:
1. **Public subnets need `map_public_ip_on_launch = true`** when `enable_nat_gateway = false`. Without NAT a public IP is the node's only route to the EKS API and to Docker Hub, and EKS rejects the node group rather than letting it come up broken.
2. **`capacity_type = "SPOT"` provisions via EC2 Fleet**, so a zero Fleet Request quota fails every launch. `node_capacity_type` now defaults to `ON_DEMAND`.
3. **A Free Plan account only launches Free-Tier-eligible instance types.** `t3.medium` is not one. Check with `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true`; in us-east-1 that's `m7i-flex.large` (8Gi), `c7i-flex.large` (4Gi, the current default), and the `.small`/`.micro` t3/t4g/t8i types. This restriction lifts if the account moves off the Free Plan.

**Service quotas are a function of account age and usage, not of the Free Plan.** A brand-new account can show an applied quota of **0 vCPU across every EC2 family and Fargate**, while `get-aws-default-service-quota` still reports the documented 5 — and `RequestServiceQuotaIncrease` returns `AccessDenied` until AWS finishes activating the account. Always check the *applied* value (`get-service-quota`), never the default, before assuming compute is available.

**Cost reality:** the EKS control plane alone is $0.10/hr ($2.40/day) and cannot be paused — only deleted. With `c7i-flex.large` nodes the stack runs ~$0.33/hr; on `t3.medium` Spot (needs a non-Free-Plan account and Fleet quota) it drops to ~$0.15/hr. Budget against the control plane first: it is ~30-65% of the bill and is charged whether or not a single pod runs. See `docs/superpowers/specs/2026-09-22-eks-static-ip-slack-bootstrap-design.md` for the full breakdown and `docs/superpowers/plans/2026-09-21-aws-eks-migration.md` for the original migration process (note: its "$200 credit" premise is outdated).

## Architecture

**Two independent deploy targets exist in this repo, don't conflate them:**
- `k8s/base/all-in-one.yaml` — plain manifest, was used for a k3s-on-a-single-EC2-host deployment (now retired).
- `k8s/eks/` — a Kustomize **overlay** on top of `k8s/base/` (`resources: [../base, ...]`), adapted for EKS: an ingress-nginx `Ingress` instead of the old nginx NodePort, `gp3` StorageClass patches (EKS ships no default EBS StorageClass since k8s 1.23+), the nginx Deployment/Service deleted via a `$patch: delete`, and `ExternalSecret`/`ClusterSecretStore` resources replacing a hardcoded plaintext `Secret`.

**The site is served on a static Elastic IP, and that dictates the ingress design.** An ALB cannot carry a static IP — AWS exposes it only as a rotating DNS name, and Elastic IP attachment is NLB-only. So `infra/terraform/static_ip.tf` allocates the EIP, `addons.tf`'s `ingress-nginx` Helm release requests an NLB with that allocation attached, and ingress-nginx does the L7 path routing (`/api`, `/admin`, `/static` → backend; `/grafana` → Grafana; `/` → frontend) an L4 NLB can't. `helm_release.aws_load_balancer_controller` is still required — it's what turns those Service annotations into a real NLB. Because the EIP exists at *plan* time, `cors_allowed_origins` and Grafana's `root_url` are derived in one apply; the old two-phase "apply, read the ALB hostname, apply again" dance is gone, along with the `alb.ingress.kubernetes.io/group.name` trick that merged two Ingresses onto one ALB.

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
