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

Driven by scripts, not raw `terraform` commands — they carry the ordered teardown, the image-preservation logic, and the Slack notifications.

```bash
cp infra/terraform/terraform.env.example infra/terraform/terraform.env   # fill it in (gitignored)

./infra/scripts/bootstrap.sh    # ONCE, as account root: IAM user, S3 state bucket, OIDC provider, EIP, budget
./infra/scripts/deploy.sh       # cluster + addons, then the app manifests
./infra/scripts/destroy.sh      # ordered teardown + "is anything still billing?" audit
```

`terraform.env` is the single config surface (there is no `terraform.tfvars`). `BOOTSTRAP_AWS_PROFILE` holds root keys and is used only by `bootstrap.sh`; `AWS_PROFILE` is the IAM-user profile bootstrap writes, and everything else runs as that.

**Two stacks, and the split matters.** `infra/terraform/bootstrap/` holds what must survive a destroy — the IAM user, the S3 state bucket, the GitHub OIDC provider, the CI infra role, the budget, and **the ingress Elastic IP**. If any of those lived in the main stack, `terraform destroy` would delete the identity running it (or release the site's address) and strand resources that keep billing. Bootstrap keeps **local state with one workspace per AWS account**, so a second account is never reconciled against the first one's state.

The main stack uses a **partial S3 backend** — `bucket` is absent from `backend.tf` and supplied at init time by the scripts as `${cluster_name}-tfstate-${account_id}`, because a bucket name embeds the account ID and hardcoding it pins the whole stack to one account.

CI equivalents: `.github/workflows/infra.yml` (`workflow_dispatch` only — plan/apply/destroy, destroy needs `DESTROY` typed in). Deliberately not on `push`: creating the cluster on every commit would drain the account.

## Architecture

**Two independent deploy targets exist in this repo, don't conflate them:**
- `k8s/base/all-in-one.yaml` — plain manifest, was used for a k3s-on-a-single-EC2-host deployment (now retired).
- `k8s/eks/` — a Kustomize **overlay** on top of `k8s/base/` (`resources: [../base, ...]`), adapted for EKS: an ingress-nginx `Ingress` instead of the old nginx NodePort, `gp3` StorageClass patches (EKS ships no default EBS StorageClass since k8s 1.23+), an `fsGroup` patch, the nginx Deployment/Service deleted via `$patch: delete`, and `ExternalSecret`/`ClusterSecretStore` resources replacing a hardcoded plaintext `Secret`.

### How the site is actually served — there is no load balancer

The AWS account **cannot create load balancers at all**: every `CreateLoadBalancer` call returns `OperationNotPermitted: This AWS account currently does not support creating load balancers`. An ALB could not carry a static IP anyway (EIP attachment is NLB-only), so the design avoids the ELB API entirely:

```
client -> Elastic IP -> node :80 -> ingress-nginx (hostNetwork DaemonSet) -> Service -> pod
```

- `addons.tf` runs **ingress-nginx as a `hostNetwork` DaemonSet** with a `ClusterIP` Service. It binds `:80`/`:443` in each node's own network namespace, so every node can serve. With hostNetwork, `dnsPolicy: ClusterFirstWithHostNet` is **required** — without it the pod inherits the node's `resolv.conf` and cannot resolve in-cluster Services.
- `static_ip.tf` attaches the EIP to a node's **primary ENI** (`attachment.device-index 0`). Associating by `instance_id` fails on any EKS node — the VPC CNI attaches secondary ENIs for pod IPs, so AWS refuses with `InvalidInstanceID: There are multiple interfaces attached`.
- Traffic arrives on the **node's** security group, not a load balancer's, so `static_ip.tf` opens 80/443 there. Without those rules the address just hangs.
- `helm_release.aws_load_balancer_controller` is still installed (IRSA/EBS plumbing) but provisions nothing.

Tradeoff: no LB-level failover. If the node holding the address dies, move the association to the surviving node — both run nginx.

### Monitoring lives outside the cluster

Prometheus **`remoteWrite`s to Grafana Cloud** and the in-cluster Grafana is disabled (`grafana_cloud_enabled`, default true). The reason is durability, not preference: in-cluster Grafana ran with `persistence.enabled = false`, so every teardown wiped all history on a cluster that is rebuilt constantly. Local retention is now a 6h buffer; Cloud is the system of record. Grafana Cloud cannot scrape a private EKS cluster, so something in-cluster must push — Prometheus already scrapes, so `remoteWrite` is the smallest change.

`infra/grafana/helpdesk-overview.json` is an importable dashboard. Note the app itself is **not instrumented** (no `django-prometheus`), and this ingress-nginx build exports only controller-level metrics — `nginx_ingress_controller_requests` and `_request_duration_seconds_bucket` do **not** exist, so there is no status-code or latency breakdown available. Panels use the process request counter and connection-state gauge instead.

### Distroless runtime — three consequences

Runtime images (`Dockerfile.backend`, `Dockerfile.frontend`) are multi-stage with a distroless final stage: no shell, no package manager, runs as **uid/gid 65532**.

1. **Every container command must be exec-form** (`["python3", "manage.py", "migrate", "--noinput"]`, not `sh -c "a && b"`), and `python3`, never bare `python`. `docker-compose.yml`'s backend-family services build against the `builder` stage (`target: builder`) because local dev's shell commands need a shell.
2. **Volumes need `fsGroup: 65532`** (`k8s/eks/patch-fsgroup.yaml`). CSI-provisioned EBS mounts root-owned; without it the non-root process cannot create `/app/data/helpdesk.log`, which `settings.py` opens at import time, so the pod dies before doing any work (`ValueError: Unable to configure handler 'file'`).
3. **Pip resolves environment markers against the BUILD interpreter.** The builder is `python:3.11-slim-bookworm` (3.11.13); the runtime is distroless 3.11.2. `redis==5.0.4` declares `async-timeout` only for `python_full_version < "3.11.3"`, so pip skipped it at build time while the runtime needed it — kombu then set `redis = None` and every celery pod died with `AttributeError: 'NoneType' object has no attribute 'Redis'`. It is now pinned explicitly. Any dependency with a version-gated marker is a candidate for this.

### Deploying the app — image placeholders

`k8s/base/all-in-one.yaml` carries `BACKEND_IMAGE_PLACEHOLDER` / `FRONTEND_IMAGE_PLACEHOLDER`, substituted by CI with `kubectl set image` **after** `kubectl apply -k`. Two traps:

- **`kubectl set image` matches containers by NAME.** The backend Deployment has an initContainer called `migrate` running the same image; setting only `backend=` leaves it on the placeholder and the pod never leaves `Init:InvalidImageName`. Both must be named.
- **Any `kubectl apply -k` resets live images back to the placeholders.** CI gets away with it by setting images immediately after; `deploy.sh` captures the live images first and restores them, so re-running it against a serving cluster doesn't take the site down.

### Secrets have two entirely separate delivery paths

1. **AWS Secrets Manager + External Secrets Operator** (`infra/terraform/secrets.tf`, `k8s/eks/externalsecret-*.yaml`) — app runtime secrets, the Slack webhook, Grafana Cloud credentials. ESO syncs them into ordinary Kubernetes `Secret` objects at the names Deployments already reference, so no spec changes when a source changes. Three things that bite:
   - Manifests must use **`external-secrets.io/v1`** — the installed operator no longer serves `v1beta1`.
   - Hand-entered secrets carry `lifecycle { ignore_changes = [secret_string] }`. Without it the next apply reads the empty variable back out and blanks them — silently, because a secret's value never appears in a plan diff.
   - `target.template.data` **replaces** the secret's contents rather than adding to them, and the v2 template engine cannot resolve a key containing a hyphen (`.admin-password` parses as subtraction). Bind the fetched value to a hyphen-free `secretKey` and emit the real key name in the template.
2. **The Django admin settings panel** (`settings_manager.AppSetting`, read via `AppSetting.get(key)`) — anything an admin reconfigures at runtime: the Slack bot's `slack_bot_token`/`slack_app_token`, SMTP creds, the Anthropic API key. **Not** environment variables, **not** GitHub/Terraform secrets. `backend/slack_bot.py` blocks on startup (`wait_for_settings()`) until these are set through the admin UI.

### Two Slack integrations, also don't conflate

- `backend/slack_bot.py` — the deployed ticket-creation bot. Socket Mode (outbound, no inbound webhook), scopes/manifest in `infra/slack/manifest.json`.
- CI/CD deploy notifications and Alertmanager runtime alerts — a Slack **Incoming Webhook**, bound to one channel at creation (the `channel` field in a payload does not override this). `infra/scripts/slack.sh` reads the webhook from Secrets Manager, falling back to `TF_VAR_slack_webhook_url`.
- `backend/slack_bridge.py` and `backend/integrations/slack_views.py` are **not wired into any deployment** — `nginx.conf`'s `/slack/` proxy target (`slack-bridge:9000`) doesn't exist as a service anywhere. Leftover; confirm intent before building on them.

### Other invariants

**Backend apps are single-writer by design**: every Deployment is `replicas: 1` because the database is **SQLite on a PersistentVolume**, not a server. Don't scale `backend` past 1 without first migrating off SQLite.

**First-user-becomes-admin** and **email-domain-gated registration** (`ALLOWED_EMAIL_DOMAIN`, currently `mindstormstudios.com`) are enforced in `accounts` — model-level for the former (`User.save()`), serializer-level for the latter (`UserCreateSerializer.validate_email`). Both break silently if `accounts/models.py`/`serializers.py` change without re-running `accounts/tests.py`.

**CI/CD** (`.github/workflows/cicd.yml`): tests → SonarCloud → Trivy → build/push to **Docker Hub** (not ECR) → deploy to EKS via GitHub OIDC → health check → Slack/email. Gated behind repo variable `EKS_DEPLOY_ENABLED == 'true'`, which no-ops rather than fails when unset. The deploy job resolves the site address from the EIP's `tag:Role=ingress-static-ip` rather than Terraform state. Its role gets `AmazonEKSEditPolicy` scoped to the `helpdesk` **and `monitoring`** namespaces plus a small ClusterRole for `external-secrets.io` resources — `ClusterSecretStore` is cluster-scoped and unreachable by any namespace-scoped grant.

## Operational gotchas

**When an EKS node group hangs in `CREATING` with zero instances, the real error is in the Auto Scaling group — nowhere else.** The node group's own `health.issues` stays empty and Terraform prints only "Still creating..." for 12+ minutes. Go straight to:

```bash
ASG=$(aws autoscaling describe-auto-scaling-groups \
  --query "AutoScalingGroups[?contains(Tags[?Key=='eks:cluster-name'].Value,'helpdesk-eks')].AutoScalingGroupName|[0]" --output text)
aws autoscaling describe-scaling-activities --auto-scaling-group-name "$ASG" \
  --max-items 3 --query 'Activities[].StatusMessage' --output text
```

Three distinct causes surfaced this way, all invisible to `terraform plan`:
1. **Public subnets need `map_public_ip_on_launch = true`** when `enable_nat_gateway = false` — without NAT a public IP is the node's only route to the EKS API and Docker Hub.
2. **`capacity_type = "SPOT"` provisions via EC2 Fleet**, so a zero Fleet Request quota fails every launch. `node_capacity_type` defaults to `ON_DEMAND`.
3. **A Free Plan account only launches Free-Tier-eligible instance types.** Check with `aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true`; `t3.medium` is not one. Default is `c7i-flex.large` (2 vCPU/4Gi). Lifts if the account leaves the Free Plan.

**`terraform destroy` deadlocks on finalizers.** Terraform tears down the `monitoring` namespace and the External Secrets operator **in parallel**; the namespace holds an `ExternalSecret` whose finalizer only that operator can clear, so the operator dies first and the namespace hangs in `Terminating` indefinitely. Terraform then never reaches the node group, and the internet gateway can't delete because instances still hold public IPs. A stuck StatefulSet pod (Prometheus) causes the same stall. Diagnose with `kubectl get ns <ns> -o json` and read `status.conditions`; unblock with:

```bash
kubectl -n monitoring patch externalsecret <name> --type=merge -p '{"metadata":{"finalizers":null}}'
kubectl -n <ns> delete pod <name> --force --grace-period=0
```

**Service quotas are a function of account age and usage, not of the Free Plan.** A day-old account can show an applied quota of **0 vCPU across every EC2 family and Fargate** while `get-aws-default-service-quota` still reports the documented 5, and `RequestServiceQuotaIncrease` returns `AccessDenied` until AWS finishes activating it. Always check the **applied** value (`get-service-quota`).

**Cost reality:** the EKS control plane alone is $0.10/hr ($2.40/day), cannot be paused, and is charged whether or not a pod runs. With `c7i-flex.large` nodes the stack is ~$0.29/hr. Budget against the control plane first. See `docs/superpowers/specs/2026-09-22-eks-static-ip-slack-bootstrap-design.md` for the full breakdown; `docs/superpowers/plans/2026-09-21-aws-eks-migration.md` is the original migration plan (its "$200 credit" premise and its ALB/NLB design are both outdated).
