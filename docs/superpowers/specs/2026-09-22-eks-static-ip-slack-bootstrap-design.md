# Helpdesk EKS — Static IP, Slack Deploy Notifications, and Bootstrap Stack

**Date:** 2026-09-22
**Status:** Design approved, pending implementation plan
**Branch:** `feature/cicd-testing-eks-terraform`
**Supersedes nothing.** Extends `docs/superpowers/plans/2026-09-21-aws-eks-migration.md` — that plan's
architecture (EKS, VPC, Spot node group, IRSA, Secrets Manager + ESO, monitoring, GitHub OIDC) is
kept as-is. This document changes exactly one delivery mechanism (ALB → NLB + Elastic IP) and adds
three things around it: a bootstrap stack, Slack notifications on apply, and teardown safety.

---

## 1. Why this document exists

`terraform apply` has never been run against the live account. The migration plan's deployment log
records the blocker: the credentials in play are the account's **root** access keys, and creating a
scoped IAM user by hand was never completed.

On top of that, three requirements arrived that the current Terraform cannot satisfy:

1. A **static IP** for the website, provisioned by `terraform apply`.
2. **Slack notification** on apply carrying the website IP and deploy result.
3. The **IAM user created by Terraform itself** — created on first run, verified and skipped on
   every run after.

Requirement 1 is the only one that forces an architectural change. Requirements 2 and 3 are additive.

---

## 2. Verified account state (checked live, 2026-09-22)

Both accounts were queried directly with `aws freetier get-account-plan-state`. The migration plan's
"$200 credit" premise is **out of date** — the real figure is $120.

| | `default` (522826274343) | `helpdesk-eks` (064271146369) |
|---|---|---|
| Plan type / status | FREE / ACTIVE | FREE / ACTIVE |
| **Credits remaining** | **$12.11** | **$120.00** |
| **Plan expiry** | **2026-09-27 (5 days)** | 2027-03-22 |
| Existing resources | — | none (default VPC only) |
| IAM users | — | **none** |

`064271146369` is the only viable target. `522826274343` expires within the week and is not worth
building against.

**The missing $80.** $120 = $100 signup + $20 already banked for the AWS Budgets task (the
deployment log confirms `helpdesk-eks-guardrail` was created). The other four $20 reward tasks —
EC2 launch/terminate, RDS config, Lambda deploy, Bedrock prompt — remain unclaimed. Completing them
raises the runway by 67% for roughly 20 minutes of work.

### 2.1 Verified service quotas (`helpdesk-eks`)

| Quota | Value | Requested by this stack | Headroom |
|---|---|---|---|
| All Standard Spot Instance Requests (vCPU) | 5 | 4 (2× t3.medium) | 1 vCPU |
| Running On-Demand Standard (vCPU) | 5 | 0 | — |
| EC2-VPC Elastic IPs | 5 | 1 (see §4) | 4 |
| VPCs per Region | 5 | 1 | 3 (one is default) |

**The Spot vCPU quota is the tight one.** 4 of 5 used. A third node, or any move to a 4-vCPU
instance type, fails the apply with a quota error. This must be called out in the implementation
plan rather than discovered at apply time.

### 2.2 Verified Kubernetes version support

`aws eks describe-cluster-versions` confirms `1.36` is `STANDARD_SUPPORT` until **2027-08-02** —
$0.10/hr, and safe for the entire credit window. The pinned version in `variables.tf` needs no
change. (1.33 and below are already `EXTENDED_SUPPORT` at $0.60/hr.)

### 2.3 Real burn rate

Spot pricing checked live: t3.medium is **$0.0165/hr** in us-east-1b/c.

| Line item | $/hr |
|---|---|
| EKS control plane | 0.100 |
| 2× t3.medium Spot | 0.033 |
| Load balancer (ALB today, NLB after) | 0.023 |
| Public IPv4 addresses | 0.015 |
| EBS (~70 GB incl. 10 Gi Prometheus) | 0.008 |
| Secrets Manager (5 secrets) | 0.003 |
| **Total** | **≈ 0.182 /hr ≈ $4.37/day** |

**$120 ÷ $0.182 ≈ 660 hours ≈ 27 days of cluster uptime for the entire six-month window.**

This single number drives every other decision in this document. The spin-up → test → destroy
operating model is not a cost optimization; it is the only way the account survives. A cluster left
running for one month straight consumes the whole balance.

---

## 3. Goals and non-goals

### Goals

- `terraform apply` runs end-to-end against `064271146369` without manual console steps.
- The website is reachable at a **static IP** that exists before the app deploys.
- Slack receives deploy start / success / failure and teardown messages, carrying the IP and URL.
- The IAM user is created by Terraform on first run and skipped on subsequent runs, including
  after state loss.
- `terraform destroy` leaves nothing billable behind.
- Secrets and variables are supplied via `terraform.env`.

### Non-goals

- Migrating off SQLite, or scaling the backend past `replicas: 1`. Unchanged constraint.
- TLS/HTTPS and a real domain. The static IP is served over HTTP. Adding ACM + a domain is a
  follow-up, and is much easier once a static IP exists.
- Replacing EKS with something cheaper. This was raised and deliberately declined — the EKS
  experience is the point of the project.
- Tightening `AdministratorAccess` on the Terraform IAM user (see §5.3).
- Multi-environment (dev/staging/prod) workspaces.

---

## 4. Change 1 — Static IP: ALB → NLB + Elastic IP + ingress-nginx

### 4.1 Why the current design cannot do it

The AWS Load Balancer Controller provisions an **Application Load Balancer** from the `Ingress`
resources in `k8s/eks/`. ALBs have no static IP — AWS exposes them only as a DNS name whose
addresses rotate. **Elastic IP attachment is supported on Network Load Balancers only.** No
annotation or configuration change makes an ALB satisfy this requirement.

This is also the root cause of an existing wart: `cors_allowed_origins` and `grafana_domain` are
both documented in `variables.tf` as circular, requiring a second `terraform apply` once the ALB
hostname is known.

### 4.2 Chosen approach

```
BEFORE:  Internet → ALB (rotating DNS name)      → backend / frontend / grafana
AFTER:   Internet → NLB + Elastic IP (static)    → ingress-nginx → backend / frontend / grafana
```

Terraform allocates the Elastic IP, so **the address is known at plan time**, before any workload
exists. This eliminates the two-phase apply entirely.

### 4.3 Alternatives considered and rejected

| Option | Cost delta | Rejected because |
|---|---|---|
| **Global Accelerator in front of the existing ALB** | **+$0.025/hr (+$18/mo)** | Zero architectural change and 2 static anycast IPs, but ~4 days of uptime bought for a capability obtainable at no cost. Correct choice if the ALB were load-bearing; it is not. |
| **Elastic IP on a worker node + NodePort** | −$0.028/hr | Cheapest by a wide margin, but the nodes are **Spot** — reclamation drops the site until the EIP is reattached. Also not a pattern worth demonstrating. |
| **Keep ALB, accept DNS name** | $0 | Does not meet the requirement. |

### 4.4 Cost impact

Slightly **negative** — the change saves about $0.005/hr.

| | Load balancer | Public IPv4 | Total |
|---|---|---|---|
| ALB (today) | $0.023/hr | 2 managed addresses, $0.010/hr | $0.033/hr |
| NLB + 1 EIP (after) | $0.023/hr | 1 Elastic IP, $0.005/hr | $0.028/hr |

The saving is incidental, not a motivation. The point is that a static IP costs nothing extra here,
which is what rules out Global Accelerator.

### 4.5 Terraform changes (`infra/terraform/`)

**New — `static_ip.tf`:**

- `aws_eip.nlb` — `count = var.nlb_az_count`, `domain = "vpc"`.
- Locals deriving `website_ip`, `website_url` (`http://<ip>`), and `grafana_url`
  (`http://<ip>/grafana`) from the allocated address.

**`addons.tf`:**

- Add `helm_release.ingress_nginx` (chart `ingress-nginx`, namespace `ingress-nginx`), with the
  controller Service annotated:
  - `service.beta.kubernetes.io/aws-load-balancer-type: external`
  - `service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: ip`
  - `service.beta.kubernetes.io/aws-load-balancer-scheme: internet-facing`
  - `service.beta.kubernetes.io/aws-load-balancer-eip-allocations: <join of aws_eip.nlb[*].id>`
  - `service.beta.kubernetes.io/aws-load-balancer-subnets: <the matching public subnet IDs>`
  - cross-zone load balancing enabled (required — see §4.7)
- `helm_release.aws_load_balancer_controller` **stays**. It is what translates those annotations
  into an actual NLB. Removing it breaks the design.

**`variables.tf`:**

- New `nlb_az_count`, default `1`. See §4.7.
- `cors_allowed_origins` and `grafana_domain` lose their "update after first apply" semantics;
  they now default to being derived from the Elastic IP. Both descriptions must be rewritten —
  leaving the stale circular-dependency warnings in place would be actively misleading.

**`outputs.tf`:**

- `website_ip`, `website_url`, `grafana_url` (replacing the current `grafana_url` built from
  `var.grafana_domain`).

### 4.6 Kubernetes manifest changes (`k8s/eks/`)

- `ingress.yaml` and `ingress-grafana.yaml`: replace `kubernetes.io/ingress.class: alb` and every
  `alb.ingress.kubernetes.io/*` annotation with `spec.ingressClassName: nginx` plus the
  ingress-nginx equivalents. Path routing (`/api` → backend:8000, `/` → frontend:3000,
  `/grafana` → grafana:80) is preserved unchanged.
- The `group.name` / `group.order` IngressGroup mechanism is **dropped**. It existed only to merge
  two Ingress objects onto one ALB. A single ingress-nginx controller serves Ingress objects across
  all namespaces natively, so both the cost motivation and the ordering workaround disappear.
  Ordering is instead handled by nginx's longest-prefix matching, which resolves `/grafana` before
  `/` without explicit priorities.
- `patch-delete-resources.yaml` is **unchanged** — the base nginx reverse-proxy Deployment stays
  deleted. ingress-nginx replaces it, and reviving the old hand-rolled proxy would be a regression.
- Health check path `/api/health/` moves from an ALB annotation to the ingress-nginx equivalent.

### 4.7 Single-AZ default, and why

An NLB requires **one Elastic IP per subnet it is attached to**. `nlb_az_count = 1` (the default)
therefore yields **exactly one static IP**, which matches the requirement as stated and is the
cheapest configuration.

The tradeoff is explicit: a single-AZ NLB is a single point of failure, and cross-zone load
balancing must be enabled so it can reach pods scheduled on nodes in the other AZ. Cross-zone
traffic on an NLB bills $0.01/GB — negligible at this traffic level, but real.

Setting `nlb_az_count = 2` yields two Elastic IPs and a genuinely HA load balancer, at +$0.005/hr.
The variable exists so this is a one-line change, not a redesign. It is not the default because
two IPs makes "the website IP" ambiguous in the Slack message for no benefit on a demo cluster.

### 4.8 IP stability across cycles

The Elastic IP lives in the **main** stack, so `terraform destroy` releases it and the next
`terraform apply` allocates a **different** address. This matches the stated requirement ("created
every time we do apply") and avoids paying ~$3.60/mo to park an idle address.

If a permanently stable address is wanted later, the fix is to move `aws_eip.nlb` into the bootstrap
stack (§5) and pass the allocation ID into the main stack as a variable. Deliberately noted here so
the decision is a known, cheap reversal rather than a rediscovery.

---

## 5. Change 2 — Bootstrap stack

### 5.1 The problem with putting the IAM user in the main stack

If `aws_iam_user.terraform_eks_admin` lives in the main stack, `terraform destroy` deletes it. Since
Terraform would be running **as** that user, the destroy revokes its own credentials partway
through, fails, and strands billable resources with no working credentials to clean them up. On an
account with 660 hours of total runway, orphaned resources are the single most expensive failure
mode available.

There is also an unavoidable ordering fact: only root can create the first IAM user. Root must
therefore run Terraform exactly once, and never again.

### 5.2 Structure

```
infra/terraform/bootstrap/     ← own state, run ONCE as root, never destroyed
infra/terraform/               ← existing stack, S3 backend, runs as terraform-eks-admin
```

**`infra/terraform/bootstrap/` contains:**

| Resource | Purpose |
|---|---|
| `aws_iam_user.terraform_eks_admin` | The scoped principal every later apply runs as |
| `aws_iam_user_policy_attachment` | `AdministratorAccess` (see §5.3) |
| `aws_iam_access_key` | Credentials, emitted as a `sensitive` output |
| `aws_s3_bucket` + versioning + SSE + public access block | Remote state for the main stack |
| `aws_budgets_budget` | Retargeted guardrail (see §7) |

The bootstrap stack is **never destroyed**. `destroy.sh` targets the main stack only.

### 5.3 `AdministratorAccess` is deliberate

EKS cluster creation touches IAM, EC2, VPC, ELB, EKS, Secrets Manager, and Auto Scaling. A
hand-scoped policy would produce a long tail of permission-denied failures to debug on a clock- and
credit-limited account. Broad now, tightened later, recorded here so it is a decision rather than an
oversight.

### 5.4 Create-or-skip, including after state loss

Terraform already handles "create if missing, skip if present" through state. The case it gets
wrong is **state loss**: the IAM user still exists in AWS but is absent from state, so apply fails
`EntityAlreadyExists` instead of skipping.

`infra/scripts/bootstrap.sh` closes that gap:

```
aws iam get-user --user-name terraform-eks-admin
  ├─ exists, in state      → no-op, proceed
  ├─ exists, NOT in state  → terraform import aws_iam_user.terraform_eks_admin, then apply
  └─ missing               → terraform apply creates it
then: write credentials to ~/.aws/credentials as profile [helpdesk-eks-tf]
```

Same treatment for the S3 state bucket, which fails `BucketAlreadyOwnedByYou` under identical
conditions.

The result is genuinely idempotent: safe on a fresh laptop, safe after a deleted state file, safe
to run repeatedly.

### 5.5 Profile separation

| Profile | Credentials | Used by |
|---|---|---|
| `helpdesk-eks` | **root** access keys (existing) | `bootstrap.sh`, once |
| `helpdesk-eks-tf` | `terraform-eks-admin` (created by bootstrap) | Every `deploy.sh` / `destroy.sh` run |

Bootstrap **writes a new profile** rather than overwriting the existing one, so a failed bootstrap
never leaves the machine with no working credentials.

**Manual step that cannot be automated:** once `helpdesk-eks-tf` is confirmed working, the root
access keys must be deleted in the AWS Console. Terraform cannot delete the root keys it is
authenticating with. Leaving them live negates the purpose of this stack, so it belongs in the
implementation plan as an explicit, checkable step.

### 5.6 Known exposure: access key in state

`aws_iam_access_key` writes the secret into bootstrap state. This is unavoidable when Terraform
creates the key. Bootstrap state is local by default — a plaintext credential on the laptop.
Accepted for a single-operator account; noted so it is not mistaken for a secure-by-default setup.
Mitigation if wanted later: move bootstrap state to the (encrypted) S3 bucket after first apply.

---

## 6. Change 3 — Slack notifications

### 6.1 Why a wrapper script, not Terraform

A `null_resource` + `local-exec` provisioner cannot report failure: if apply dies before reaching
it, it never runs — which is exactly when a notification matters most. Notification therefore lives
in a wrapper around Terraform, not inside it.

### 6.2 Scripts

| Script | Responsibility |
|---|---|
| `infra/scripts/bootstrap.sh` | §5.4 flow; Slack notify on completion |
| `infra/scripts/deploy.sh` | source env → init → plan → apply → `kubectl apply -k k8s/eks/` → wait for rollout → Slack |
| `infra/scripts/destroy.sh` | ordered teardown (§8) → Slack |
| `infra/scripts/slack.sh` | shared Block Kit message builder, sourced by the others |

### 6.3 Message content

- **Start** — "🚀 Deploying helpdesk-eks", region, target account, timestamp.
- **Success** — website URL at the static IP, Grafana URL, resource add/change/destroy counts,
  wall-clock duration, and **credits remaining** read live from
  `aws freetier get-account-plan-state`. The credit figure is the point: it turns an abstract
  budget into a number seen on every single deploy.
- **Failure** — the failing stage plus the last ~20 lines of Terraform output, enough to triage
  from a phone without opening a laptop.
- **Teardown** — destroy confirmation and credits remaining. This matters more than it appears:
  an apply believed to be torn down but actually still running is the most likely way the $120 is
  lost.

### 6.4 Webhook reuse

Uses the existing `var.slack_webhook_url` and its `helpdesk/slack-webhook-url` Secrets Manager
entry. No new secret, no new channel. Consistent with `CLAUDE.md`'s note that the CI deploy webhook
and the Alertmanager webhook are the same URL with different senders — this adds a third sender to
the same URL.

Sending is a plain `curl` POST from the operator's machine, so an invalid or unset webhook must
**warn and continue**, never fail the deploy. A broken notification must not be able to abort or
roll back working infrastructure.

---

## 7. Change 4 — Cost guardrails

### 7.1 The existing budget is miscalibrated

`helpdesk-eks-guardrail` is set to **$180/month** against a **$120 total, six-month** balance. Its
first alert at 50% fires at $90 — after 75% of everything available has been spent. It earned its
$20 reward but provides no practical protection.

**Retarget to $30/month with alerts at 25% / 50% / 80%** ($7.50 / $15 / $24). Managed in the
bootstrap stack so it survives every `terraform destroy`.

### 7.2 Credit-depletion visibility

`get-account-plan-state` is read and reported in every Slack message (§6.3). Cheap, and it surfaces
the number that actually matters on a cadence tied to the activity that consumes it.

### 7.3 Idle-cluster protection

An idle cluster is the primary threat to the account. The implementation plan must include, at
minimum, a documented teardown discipline, and should evaluate a scheduled reminder (a Slack ping
if the cluster has existed beyond N hours). Full auto-destroy automation is explicitly **out of
scope** for this document — the mechanism (EventBridge + Lambda vs. local scheduler) needs its own
decision, and a half-considered auto-destroy is more dangerous than none.

---

## 8. Change 5 — Teardown ordering (orphaned load balancer)

**This is the highest-value correctness item in this document.**

The NLB is created by an in-cluster controller reacting to a Kubernetes Service, so **it does not
exist in Terraform state**. A naive `terraform destroy`:

1. deletes the EKS cluster,
2. leaves the NLB running and billing,
3. fails to delete the VPC, because the orphaned NLB still holds ENIs in its subnets,
4. leaves the operator hand-deleting resources in the console while they bill.

`destroy.sh` must therefore tear down in this order:

1. `kubectl delete -k k8s/eks/` (removes Ingress objects and the ingress-nginx Service)
2. Poll until the NLB is actually gone from `elbv2 describe-load-balancers` — deletion is
   asynchronous and `kubectl delete` returning is not proof of completion
3. `terraform destroy` on the main stack
4. Verify: zero EKS clusters, zero load balancers, zero unattached Elastic IPs, zero EBS volumes
5. Slack teardown message with credits remaining

Step 4 is not optional. "Destroy reported success" and "nothing is billing" are different claims,
and on this account only the second one matters.

---

## 9. Configuration — `terraform.env`

Replaces `terraform.tfvars` as the single configuration surface. Both conventions coexisting would
invite drift, so **`terraform.tfvars.example` is removed**.

**`infra/terraform/terraform.env.example`** (committed):

```bash
# Profile holding ROOT keys — used by bootstrap.sh once, then never again.
export BOOTSTRAP_AWS_PROFILE="helpdesk-eks"

# Profile created by bootstrap.sh — used by every deploy/destroy afterwards.
export AWS_PROFILE="helpdesk-eks-tf"
export AWS_REGION="us-east-1"

export TF_VAR_github_repository="iam-adnan/helpdesk"
export TF_VAR_slack_webhook_url=""      # https://hooks.slack.com/services/XXX/YYY/ZZZ
export TF_VAR_nlb_az_count="1"          # 1 = one static IP (default); 2 = HA, two IPs

# Only required if the Docker Hub repos are private:
export TF_VAR_dockerhub_username=""
export TF_VAR_dockerhub_token=""
```

`terraform.env` (real values) is **gitignored**. The current `.gitignore` covers `*.tfvars` but not
this file, so it must be updated in the same change — adding the file and forgetting the ignore rule
would commit a live Slack webhook and Docker Hub token.

Every script begins by sourcing `terraform.env` and failing loudly if it is absent.

---

## 10. Verification

Design is not considered delivered until all of these are observed, not assumed:

1. `bootstrap.sh` on a clean account creates the IAM user, key, state bucket, and budget.
2. `bootstrap.sh` run a **second** time is a clean no-op.
3. `bootstrap.sh` with its state file **deleted** imports and no-ops rather than failing
   `EntityAlreadyExists`. This is the requirement as literally stated and needs explicit proof.
4. `deploy.sh` completes; `terraform output website_ip` returns the Elastic IP.
5. The NLB's assigned address **equals** that Elastic IP.
6. `curl http://<ip>/` serves the frontend; `curl http://<ip>/api/health/` returns healthy;
   `http://<ip>/grafana` reaches the Grafana login.
7. Slack received start and success messages, with the correct IP and a plausible credit figure.
8. A deliberately failed apply (e.g. bad variable) produces a Slack **failure** message.
9. `destroy.sh` completes; the post-destroy audit (§8, step 4) returns zero of everything.
10. `aws freetier get-account-plan-state` after a full cycle shows a credit drop consistent with
    §2.3 — confirming no silent drain.

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Orphaned NLB after destroy | **High** — silent ongoing spend | §8 ordered teardown + explicit post-destroy audit |
| Spot vCPU quota (4 of 5 used) | Medium — apply fails outright | Documented in plan; do not add nodes without a quota increase |
| Spot reclamation mid-demo | Medium | 2 nodes across AZs; pods reschedule. Accepted for a demo cluster |
| Access key in bootstrap state | Medium | §5.6; single-operator account, documented not hidden |
| Root keys left live after bootstrap | Medium | Explicit manual checklist step; cannot be automated |
| ingress-nginx pods add to node pressure | Low | Frees the ALB controller's routing load; t3.medium was already sized with headroom |
| Credits expire 2027-03-22 with work unfinished | Low | 27 days of uptime across ~6 months is ample under destroy-between-sessions |

---

## 12. Summary of files touched

**New**
- `infra/terraform/bootstrap/{main,variables,outputs,versions}.tf`
- `infra/terraform/static_ip.tf`
- `infra/terraform/backend.tf`
- `infra/terraform/terraform.env.example`
- `infra/scripts/{bootstrap,deploy,destroy,slack}.sh`

**Modified**
- `infra/terraform/{addons,variables,outputs}.tf`
- `k8s/eks/{ingress,ingress-grafana}.yaml`
- `.gitignore` (add `terraform.env`)
- `CLAUDE.md` (ALB → NLB/ingress-nginx; new script-based workflow)

**Removed**
- `infra/terraform/terraform.tfvars.example` (superseded by `terraform.env.example`)

**Unchanged** — `eks.tf`, `vpc.tf`, `irsa.tf`, `secrets.tf`, `monitoring.tf`, `github-oidc.tf`,
`storageclass.tf`, `providers.tf`, `versions.tf`, `k8s/base/`, all `externalsecret-*.yaml`,
`patch-delete-resources.yaml`.
