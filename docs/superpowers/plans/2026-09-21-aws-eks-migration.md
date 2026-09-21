# Helpdesk AWS EKS Migration — Process, Budget Plan, and Testing Plan

> **Implementation note (2026-09-21, branch `feature/cicd-testing-eks-terraform`):** the actual
> implementation deviates from this doc in two ways, per explicit direction:
> 1. **Registry stays Docker Hub, not ECR.** The real pipeline order is
>    commit/merge → GitHub Actions → build → Trivy → Docker Hub → EKS, matching the
>    existing `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secrets already configured — Task 7
>    (ECR) below was dropped, and `infra/terraform/github-oidc.tf`'s deploy role carries
>    no ECR permissions at all.
> 2. **AWS Secrets Manager + External Secrets Operator (ESO)** was added (not in this
>    doc's original Task list) to replace the plaintext `SECRET_KEY` that used to be
>    committed directly in `k8s/all-in-one.yaml`'s `Secret` object. See
>    `infra/terraform/secrets.tf`, `infra/terraform/irsa.tf`'s `external_secrets_irsa`,
>    `infra/terraform/addons.tf`'s `helm_release.external_secrets`, and
>    `k8s/eks/secretstore.yaml`/`externalsecret-*.yaml`.
>
> Also: `k8s/all-in-one.yaml` moved to `k8s/base/all-in-one.yaml` (standard Kustomize
> base/overlay sibling layout — `k8s/eks/` is the overlay), the nginx reverse-proxy
> Deployment/Service is dropped on EKS (replaced by the ALB `Ingress`), and both
> Dockerfiles are now distroless multi-stage builds (see `Dockerfile.backend`/
> `Dockerfile.frontend` and `docker-compose.yml`'s `target: builder` local-dev override).
> The task-by-task detail below is otherwise still accurate and was used as-is.
>
> **Second amendment (same date):** monitoring added — `kube-prometheus-stack`
> (Prometheus + Grafana + Alertmanager + kube-state-metrics + node-exporter) via
> `infra/terraform/monitoring.tf`, Grafana routed through the *same* ALB as the app
> (no second load balancer — see the IngressGroup note in Task 16 below), and
> Alertmanager wired to the same Slack webhook for runtime failure alerts (crash
> loops, node not ready, high resource usage — distinct from the CI pipeline's
> existing deploy-result Slack notification). This pushed the default worker node
> type from `t3.small` to `t3.medium` (see Task 16 and the updated cost table) — the
> monitoring stack's pod requests didn't comfortably fit alongside everything else
> on 2x t3.small. See Task 16 for the full detail; it wasn't in this doc's original
> scope.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "🚀 Deploy to K3s on EC2" job in `.github/workflows/cicd.yml` (from `docs/superpowers/plans/2026-09-21-cicd-testing-slack.md`, Task 1) with a real Amazon EKS deployment, built entirely with Terraform, that fits inside a **$200 AWS credit** on a brand-new "Free Plan" account — and comes back out clean (fully destroyable) between sessions so the credit isn't burned by an idle cluster sitting around.

**Architecture:** Terraform provisions a minimal VPC + EKS cluster + a small EC2 managed node group (Spot) + the AWS Load Balancer Controller (via IRSA) + the EBS CSI driver (via IRSA). GitHub Actions authenticates to AWS via OIDC federation (no long-lived access keys in GitHub secrets) and deploys the existing `k8s/` manifests — lightly adapted for EKS — through `kubectl`/`kustomize`. The operating model is **spin-up → test → destroy**, not "leave it running": EKS's $0.10/hr control-plane fee is fixed the moment a cluster exists, so the single biggest cost lever is *how long the cluster exists*, not how it's configured.

**Tech Stack:** Terraform (`terraform-aws-modules/vpc` + `terraform-aws-modules/eks`), AWS CLI v2, `kubectl`, Helm (for the AWS Load Balancer Controller), Amazon EKS, EC2 Spot managed node group, Amazon ECR, Amazon VPC, IAM (OIDC/IRSA), AWS Budgets + CloudWatch Billing Alarms, k6 (load testing), tfsec/Checkov (IaC scanning).

**Spec:** Continues from `docs/superpowers/plans/2026-09-21-cicd-testing-slack.md`. That plan's Tasks 2–10 (backend `pytest` + frontend Jest suites) and Task 12 (Slack CI notifications) are unaffected and still apply — this plan only replaces the deploy target and the "Deploy to K3s" job.

## Global Constraints — read this before spending anything

- **EKS is not a free-tier service.** Confirmed directly: "Amazon Elastic Kubernetes Service (Amazon EKS) is available on AWS, but it extends beyond the AWS Free Tier... EKS is not included in the always-free services and would draw from your $200 credit pool" ([AWS Free Tier Explained, Spot/Rackspace](https://spot.rackspace.com/blog/aws-free-tier)). Every hour the cluster exists costs real credit from minute one.
- **Your account almost certainly has no free EC2/RDS hours either.** AWS retired the classic "750 hrs/month t2.micro/t3.micro for 12 months" free tier for any account created after **July 15, 2025**. New accounts run entirely on the $200 credit pool instead — confirmed via [CloudWebSchool's 2026 Free Tier writeup](https://cloudwebschool.com/docs/aws/fundamentals/aws-free-tier/) and [InfraTally's 2026 Free Tier analysis](https://infratally.com/articles/aws-free-tier-2026.html). Plan every resource — nodes, NAT Gateway, ALB, EBS, ECR storage — as chargeable.
- **The $200 is two pieces, and the second half is a checklist, not a guarantee.** New accounts get **$100 automatically at signup**, plus **up to $100 more** ($20 each) for completing five onboarding tasks: launch+terminate an EC2 instance, configure an RDS database, deploy a Lambda function, test a prompt in Bedrock, set up an AWS Budget ([AWS Builder Center](https://builder.aws.com/content/2zmBcwokU8Y0C1zacGmXsRDpXP6/aws-free-tier-unlock-dollar200-in-free-credits-for-new-users)). **Do these five first (Task 0 below) before touching EKS** — they're each trivial, one of them (the Budget) is a guardrail you need anyway, and skipping them leaves $100 of real usable credit on the table.
- **Credit validity: 6 months from account creation, or until depleted, whichever comes first.** Pace accordingly — don't let the cluster idle.
- **EKS control plane: $0.10/hr ≈ $73/month, fixed, per cluster, regardless of node count** ([CloudZero EKS Pricing 2026](https://www.cloudzero.com/blog/eks-pricing/)). This single line item is ~36% of the entire credit pool if run for just one month straight. There is no way to pause it — only delete-and-recreate the cluster.
- **NAT Gateway is the second-biggest silent drain**: $0.045/hr/AZ (~$32.85/mo) **plus** $0.045/GB processed in both directions ([enforza.io NAT Gateway pricing](https://enforza.io/aws-nat-gateway-cost/), [CloudBurn NAT Gateway calculator](https://cloudburn.io/blog/aws-nat-gateway-pricing)). Default recommendation below avoids it entirely for day-to-day testing.
- **ALB: ~$0.0225/hr (~$16.43/mo) + $0.008/LCU-hr** ([CloudZero ALB Pricing 2026](https://www.cloudzero.com/blog/aws-alb-pricing/)).
- **t3.small on-demand: $0.0208/hr (~$15.18/mo). Spot: typically 70–90% cheaper**, e.g. ~$0.004–0.006/hr depending on capacity/region ([Vantage t3.small pricing](https://instances.vantage.sh/aws/ec2/t3.small), [nOps Spot pricing guide](https://www.nops.io/blog/aws-spot-instance-pricing/)). Spot pricing fluctuates with market demand — treat the numbers below as planning estimates, not guarantees.
- **Region: use `us-east-1` (N. Virginia).** It's the cheapest/most feature-complete region and every price above is quoted for it. Latency from Pakistan doesn't matter here — this cluster is for hands-on practice, CI validation, and portfolio evidence, not serving real end-user traffic.
- **Existing app constraint carried over unchanged:** the app persists to **SQLite on a local volume**, not a real database server, and every Deployment in `k8s/all-in-one.yaml` is already `replicas: 1`. Keep it that way on EKS — SQLite has no safe multi-writer story, so do **not** scale the backend Deployment beyond 1 replica without first migrating off SQLite (out of scope for this plan).
- **No StorageClass is defined in `k8s/all-in-one.yaml`** (the two PVCs — `sqlite-pvc`, `media-pvc` — rely on the cluster's default). k3s ships a default (`local-path`); **EKS does not ship a default StorageClass for EBS at all since Kubernetes 1.23** (the in-tree EBS provisioner was removed) — you must install the **Amazon EBS CSI Driver** add-on and define a `gp3` StorageClass, or every PVC in the manifest will stay stuck `Pending` forever. This is Task 5 below.
- **Current manifest exposes the app via a bare `nginx` reverse-proxy pod on `NodePort 30080`** (`k8s/all-in-one.yaml:414-425`) — that pattern doesn't translate to EKS the way it worked on a single EC2 host. This plan replaces it with a real `Ingress` behind an ALB (Task 6), which is also the more interview-relevant pattern to have hands-on experience with.

---

## Task 0: Bank the full $200 credit before spending any of it on EKS

**Files:** none — AWS Console/CLI only.

- [ ] **Step 1: Set up AWS Budgets FIRST** (this is one of the 5 reward tasks *and* your safety net for everything after it)

Console → Billing and Cost Management → Budgets → Create budget → Cost budget → set **$180 monthly, alert at 50%/80%/100%** to your email. This both earns $20 and gives you an actual tripwire before the other four tasks and everything in Task 1+ can run away.

- [ ] **Step 2: Complete the other four reward tasks** (each is genuinely trivial and self-contained — don't skip them, they're worth $80 combined)
  - Launch a `t2.micro`/`t3.micro` EC2 instance in the console, wait for it to reach "running", then terminate it.
  - Launch an RDS instance (`db.t3.micro`, smallest engine, e.g. free-eligible-sized MySQL) — you can delete it immediately after it finishes provisioning; the credit is for *configuring* one, not running it long-term.
  - Deploy any trivial "Hello World" Lambda function from a blueprint.
  - Open Amazon Bedrock, send one test prompt to any available model.

- [ ] **Step 3: Confirm the credit balance reflects $200 (or close to it)**

Console → Billing → Credits, or `aws billingconductor` / the Billing dashboard. Screenshot this for your own records before starting Task 1 — you want a clean before/after picture of what EKS actually costs you.

---

## Cost Plan: what EKS will actually cost you, and the operating pattern to control it

Two very different numbers apply depending on whether the cluster is left running or torn down between sessions. **Default to the spin-up/destroy pattern** — everything in this plan is built with Terraform specifically so that's a two-command operation (`terraform apply` / `terraform destroy`), not a manual teardown checklist you'll forget to run.

| Scenario | EKS control plane | Worker nodes (2× t3.medium — see Task 16's node-sizing note) | NAT Gateway | ALB (shared with Grafana via IngressGroup, still one ALB) | EBS (app + Prometheus's 10Gi) + ECR | **Total** |
|---|---|---|---|---|---|---|
| **Left running 24/7, on-demand nodes, with NAT** | $73.00/mo | $60.74/mo | ~$33–43/mo (incl. data processing) | ~$18–22/mo | ~$2.80/mo | **~$188–202/mo → drains $200 in ~4 weeks** |
| **Left running 24/7, Spot nodes, no NAT** (nodes in public subnet, tight SG) | $73.00/mo | ~$12–18/mo | $0 | ~$18–22/mo | ~$2.80/mo | **~$106–116/mo → drains $200 in ~6–7 weeks** |
| **Spin-up/destroy, ~40 hrs total hands-on time, Spot nodes, mostly no NAT** | $4.00 (40hr × $0.10) | ~$1.00 | ~$0.35 (only during the 1–2 sessions you test the "with NAT" pattern) | ~$0.90 + minor LCU | ~$0.55 | **~$7–11 for the entire exercise** |

(t3.medium is ~2x t3.small's price at every tier — bumped from the original t3.small default once monitoring was added; see Task 16. The spin-up/destroy row barely moves either way — this is still the operating pattern to actually use.)

The third row is the intended way to use this plan. **~40 hours of genuine hands-on EKS time (enough to do every task below, twice over, with room for mistakes) costs under $10** and leaves the other ~$190 of credit for later experimentation, a longer "showcase window" before a job interview, or just margin for error.

**If you want a live demo link for a few days** (e.g. to share in a portfolio or an interview), budget roughly **$4–5.50/day** for that window (no-NAT variant), or **$5.50–6.50/day** with the NAT Gateway pattern — then destroy it again.

**Hard rule:** never leave the cluster running unattended across days you're not actively working on it. There is no "stop" for the EKS control plane — only "exists" (billing) or "destroyed" (not billing).

---

## Tool List

| Tool | Role | Cost |
|---|---|---|
| **Terraform** (CLI, ≥1.9) | Provisions VPC, EKS cluster, node group, IAM roles/OIDC, Secrets Manager entries, and the monitoring stack — everything as versioned code you can `apply`/`destroy` on demand | Free (matches your existing Terraform Associate cert) |
| `terraform-aws-modules/vpc/aws` | Community module for the VPC/subnets — avoids hand-rolling networking | Free |
| `terraform-aws-modules/eks/aws` | Community module for the EKS cluster + managed node group + IRSA wiring | Free |
| **AWS CLI v2** | `aws eks update-kubeconfig`, `aws ecr get-login-password`, ad-hoc resource checks/teardown verification | Free |
| **kubectl** | Deploy and inspect workloads on the cluster | Free |
| **Helm** (v3) | Installs the AWS Load Balancer Controller and metrics-server charts | Free |
| **AWS Load Balancer Controller** | In-cluster controller that turns a Kubernetes `Ingress` into a real ALB | Free (the ALB it creates is billed, see cost table) |
| **Amazon EBS CSI Driver** (EKS add-on) | Provides the `gp3` StorageClass the `sqlite-pvc`/`media-pvc` PVCs need — EKS ships no default EBS StorageClass | Free (billed via the EBS volumes it provisions — already in cost table) |
| **metrics-server** (EKS add-on or Helm chart) | Backs `kubectl top` and any HPA you experiment with later | Free |
| **Amazon EKS** | Managed Kubernetes control plane | $0.10/hr — see cost table |
| **EC2 managed node group (Spot)** | Worker nodes | Per-hour, Spot pricing — see cost table |
| **Amazon VPC** | Custom networking (2 AZ, public/private subnets) | Free itself; NAT Gateway inside it is billed |
| **IAM + OIDC (IRSA)** | Scoped permissions for the ALB Controller, EBS CSI driver, External Secrets Operator pods, and a separate OIDC role for GitHub Actions (no static AWS keys in GitHub secrets) | Free |
| **AWS Secrets Manager** | Source of truth for runtime secrets — Django `SECRET_KEY`, CORS origins, Grafana admin password, Slack webhook URL — nothing committed to git in plaintext | ~$0.40/secret/month + API calls, ~$2/mo total for the 5 secrets this plan creates |
| **External Secrets Operator** | Syncs AWS Secrets Manager entries into real Kubernetes Secrets at the names the Deployments/Alertmanager/Grafana already expect | Free |
| **AWS Budgets + CloudWatch Billing Alarm** | Spend guardrail — alerts before you approach $200 | Free |
| **GitHub Actions** (already in use) | CI/CD orchestration — the "deploy" job changes target from SSH/EC2 to `kubectl` via OIDC; registry is Docker Hub, not ECR (see the implementation-note amendment at the top of this doc) | Free (public repo) or existing GH plan |
| **k6** | Lightweight load-testing tool for the post-deploy smoke/load test | Free, open source |
| **tfsec** or **Checkov** | Static analysis of the Terraform for security/cost misconfigurations before `apply` | Free, open source |
| **k9s** (optional) | Terminal UI for quickly eyeballing cluster state during testing/demos | Free, open source |
| **kube-prometheus-stack** (Prometheus + Grafana + Alertmanager + kube-state-metrics + node-exporter) | Node health, cluster-wide stats (Grafana dashboards ship out of the box), and a large default Prometheus alerting rule set — crash loops, node-not-ready, resource pressure, etc. | Free itself; the ~10Gi EBS volume for Prometheus's TSDB is billed (already in cost table) |
| **Slack (Alertmanager route)** | Runtime failure notifications — separate from the CI pipeline's own deploy-result Slack step, same webhook/channel | Free (Slack Incoming Webhook) |

---

## The Process

### Task 1: Bootstrap IAM — Terraform's own AWS access, kept out of long-lived keys where possible

**Files:**
- Create: `infra/terraform/versions.tf`, `infra/terraform/providers.tf`

- [ ] **Step 1: Create an IAM user or role dedicated to Terraform, scoped to what this plan needs**

Console → IAM → create a user `terraform-eks-admin` with an attached policy limited to VPC, EKS, EC2, IAM (role/policy creation for IRSA), ECR, and CloudWatch — not full `AdministratorAccess` if avoidable, since this is exactly the kind of habit that shows well in a portfolio/interview. Generate an access key for local `terraform apply` runs only (not for CI — CI gets its own OIDC role in Task 8).

- [ ] **Step 2: Configure the AWS CLI locally**

```bash
aws configure --profile helpdesk-eks
aws sts get-caller-identity --profile helpdesk-eks
```

Expected: returns your new IAM user's ARN.

- [ ] **Step 3: Create the Terraform project skeleton**

```
infra/terraform/
  versions.tf
  providers.tf
  vpc.tf
  eks.tf
  irsa.tf
  ecr.tf
  outputs.tf
  terraform.tfvars
```

`infra/terraform/providers.tf`:

```hcl
provider "aws" {
  region  = "us-east-1"
  profile = "helpdesk-eks"
}
```

`infra/terraform/versions.tf`:

```hcl
terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/versions.tf infra/terraform/providers.tf
git commit -m "infra: bootstrap Terraform AWS provider for EKS"
```

---

### Task 2: VPC — no NAT Gateway by default, public subnets for worker nodes

**Files:**
- Create: `infra/terraform/vpc.tf`

**Interfaces:**
- Produces: `module.vpc.vpc_id`, `module.vpc.public_subnets`, `module.vpc.private_subnets` — consumed by Task 3's EKS module.

Two subnet layouts, pick per-session based on what you're practicing:

```hcl
# infra/terraform/vpc.tf
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "helpdesk-eks-vpc"
  cidr = "10.42.0.0/16"

  azs             = ["us-east-1a", "us-east-1b"]
  public_subnets  = ["10.42.0.0/20", "10.42.16.0/20"]
  private_subnets = ["10.42.32.0/20", "10.42.48.0/20"]

  enable_nat_gateway = var.enable_nat_gateway
  single_nat_gateway = true # only relevant when enable_nat_gateway = true — one NAT, not one per AZ

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  tags = { Project = "helpdesk-eks" }
}

variable "enable_nat_gateway" {
  description = "true = nodes go in private subnets behind a NAT Gateway (~$33+/mo extra, closer to a real production pattern). false = nodes go in public subnets with a locked-down security group (default, cheapest)."
  type        = bool
  default     = false
}
```

- [ ] **Step 1: `terraform init && terraform validate`**

```bash
cd infra/terraform
terraform init
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 2: Commit**

```bash
git add infra/terraform/vpc.tf
git commit -m "infra: VPC module with toggleable NAT Gateway (default off for cost)"
```

---

### Task 3: EKS cluster + Spot managed node group

**Files:**
- Create: `infra/terraform/eks.tf`

**Interfaces:**
- Consumes: `module.vpc.vpc_id`, `module.vpc.public_subnets`/`private_subnets` from Task 2.
- Produces: `module.eks.cluster_name`, `module.eks.cluster_endpoint`, `module.eks.oidc_provider_arn` — consumed by Task 4 (IRSA), Task 5 (add-ons), Task 8 (GitHub Actions OIDC).

```hcl
# infra/terraform/eks.tf
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "helpdesk-eks"
  cluster_version = "1.31"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = var.enable_nat_gateway ? module.vpc.private_subnets : module.vpc.public_subnets

  cluster_endpoint_public_access = true

  enable_irsa = true

  eks_managed_node_groups = {
    default = {
      instance_types = ["t3.small"]
      capacity_type  = "SPOT"
      min_size       = 2
      max_size       = 2
      desired_size   = 2
      subnet_ids     = var.enable_nat_gateway ? module.vpc.private_subnets : module.vpc.public_subnets
    }
  }

  tags = { Project = "helpdesk-eks" }
}
```

Note the `t3.small` × 2 sizing: `docker-compose.yml` runs `backend`, `frontend`, `celery`, `slack-bot`, `redis`, `nginx` as six containers today. Two `t3.small` nodes (2 vCPU / 2GiB RAM each, 4 vCPU / 4GiB total) is tight for six pods plus the ALB Controller/EBS CSI driver/metrics-server system pods — if pods stay `Pending` on scheduling in Task 6, bump to `t3.medium` (still Spot, roughly the same or slightly higher cost than 2×t3.small — check current Spot pricing before switching) rather than adding a third node, to keep the control-plane-to-node ratio simple.

- [ ] **Step 1: `terraform plan` and read every resource it intends to create**

```bash
terraform plan -out=tfplan
```

Expected: plan shows the VPC, EKS cluster, node group, and associated IAM roles (~25-40 resources depending on module defaults). Read it — this is the point where you catch "oh, that's going to cost more than I expected" before it's real.

- [ ] **Step 2: Static-scan the plan before applying**

```bash
tfsec infra/terraform/
```

Expected: no `CRITICAL`/`HIGH` findings on anything you don't already understand and accept (e.g. `cluster_endpoint_public_access = true` will likely flag — that's an accepted tradeoff for a learning cluster you're not leaving running long-term; a real production cluster would restrict this to a VPN/bastion CIDR).

- [ ] **Step 3: Apply and time how long it actually takes**

```bash
terraform apply tfplan
```

Expected: EKS cluster creation typically takes **10–15 minutes**. Note the time — this is "dead" money (control plane billing starts the moment the cluster resource is created, not when it's ready), and it matters for planning how you budget a session.

- [ ] **Step 4: Point `kubectl` at the new cluster**

```bash
aws eks update-kubeconfig --name helpdesk-eks --region us-east-1 --profile helpdesk-eks
kubectl get nodes
```

Expected: 2 nodes, `STATUS Ready`.

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/eks.tf
git commit -m "infra: EKS cluster with 2x t3.small Spot managed node group"
```

---

### Task 4: IRSA roles for the AWS Load Balancer Controller and EBS CSI driver

**Files:**
- Create: `infra/terraform/irsa.tf`

**Interfaces:**
- Consumes: `module.eks.oidc_provider_arn`, `module.eks.cluster_name` from Task 3.
- Produces: `module.lb_controller_irsa.iam_role_arn`, `module.ebs_csi_irsa.iam_role_arn` — consumed by Task 5's Helm/add-on install and Task 6's Ingress setup.

```hcl
# infra/terraform/irsa.tf
module "lb_controller_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "helpdesk-eks-lb-controller"

  attach_load_balancer_controller_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

module "ebs_csi_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "helpdesk-eks-ebs-csi"

  attach_ebs_csi_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
}
```

- [ ] **Step 1: `terraform plan && terraform apply`**

```bash
terraform plan -out=tfplan && terraform apply tfplan
```

Expected: two new IAM roles created, no changes to the cluster/nodes.

- [ ] **Step 2: Commit**

```bash
git add infra/terraform/irsa.tf
git commit -m "infra: IRSA roles for ALB controller and EBS CSI driver"
```

---

### Task 5: Install cluster add-ons (EBS CSI driver, ALB Controller, metrics-server)

**Files:**
- Create: `infra/terraform/addons.tf` (EBS CSI as a managed EKS add-on)
- Create: `k8s/eks/storageclass.yaml`

**Interfaces:**
- Consumes: `module.ebs_csi_irsa.iam_role_arn`, `module.eks.cluster_name` from Tasks 3–4.

- [ ] **Step 1: Add the EBS CSI driver as a managed EKS add-on**

```hcl
# infra/terraform/addons.tf
resource "aws_eks_addon" "ebs_csi" {
  cluster_name             = module.eks.cluster_name
  addon_name               = "aws-ebs-csi-driver"
  service_account_role_arn = module.ebs_csi_irsa.iam_role_arn
}
```

```bash
terraform apply -target=aws_eks_addon.ebs_csi
```

- [ ] **Step 2: Define and apply the `gp3` StorageClass**

```yaml
# k8s/eks/storageclass.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
parameters:
  type: gp3
```

```bash
kubectl apply -f k8s/eks/storageclass.yaml
kubectl get storageclass
```

Expected: `gp3` listed with `(default)` next to its name.

- [ ] **Step 3: Install the AWS Load Balancer Controller via Helm**

```bash
helm repo add eks https://aws.github.io/eks-charts
helm repo update

kubectl create serviceaccount -n kube-system aws-load-balancer-controller --dry-run=client -o yaml | \
  kubectl annotate -f - eks.amazonaws.com/role-arn=<lb_controller_irsa_role_arn_from_terraform_output> --local -o yaml | \
  kubectl apply -f -

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=helpdesk-eks \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

Expected: `kubectl get deployment -n kube-system aws-load-balancer-controller` shows `1/1` ready within ~1-2 minutes.

- [ ] **Step 4: Install metrics-server**

```bash
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm install metrics-server metrics-server/metrics-server -n kube-system
kubectl top nodes
```

Expected: CPU/memory numbers printed per node (may take ~1 minute to warm up after install).

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/addons.tf k8s/eks/storageclass.yaml
git commit -m "infra: install EBS CSI driver, gp3 StorageClass, ALB controller, metrics-server"
```

---

### Task 6: Adapt `k8s/all-in-one.yaml` for EKS (ECR images, StorageClass, Ingress instead of NodePort)

**Files:**
- Create: `k8s/eks/kustomization.yaml`
- Create: `k8s/eks/patch-storageclass.yaml`
- Create: `k8s/eks/ingress.yaml`
- Modify: `k8s/all-in-one.yaml` (base, referenced by the overlay — no direct edits needed if Kustomize patches handle every difference)

**Interfaces:**
- Consumes: `k8s/all-in-one.yaml` as the Kustomize base; ECR repo URIs from Task 7.

The base manifest is otherwise reusable as-is (same Deployments/Services/PVCs/ConfigMaps) — three things differ for EKS: (1) PVCs need `storageClassName: gp3` explicitly, (2) container images point at ECR instead of Docker Hub, (3) the `nginx` NodePort Service is replaced by an `Ingress` that the ALB Controller turns into a real load balancer.

- [ ] **Step 1: Kustomize base + overlay**

```yaml
# k8s/eks/kustomization.yaml
namespace: helpdesk
resources:
  - ../../k8s/all-in-one.yaml
  - ingress.yaml
patches:
  - path: patch-storageclass.yaml
    target:
      kind: PersistentVolumeClaim
images:
  - name: BACKEND_IMAGE_PLACEHOLDER
    newName: <account-id>.dkr.ecr.us-east-1.amazonaws.com/helpdesk-backend
    newTag: latest
  - name: FRONTEND_IMAGE_PLACEHOLDER
    newName: <account-id>.dkr.ecr.us-east-1.amazonaws.com/helpdesk-frontend
    newTag: latest
```

Confirmed directly against `k8s/all-in-one.yaml`: the `backend`, `celery`, and `slack-bot` Deployments (lines 138, 159, 287, 337) all use the literal placeholder string `BACKEND_IMAGE_PLACEHOLDER`, and `frontend` (line 240) uses `FRONTEND_IMAGE_PLACEHOLDER` — these aren't real image refs, they're substitution tokens the old `sed`/`kubectl set image` k3s deploy step filled in at deploy time. Kustomize's `images:` transformer matches on exactly this kind of literal string, so no changes to the base manifest are needed — the overlay substitutes all four occurrences (3 backend-image Deployments + 1 frontend) in one pass. Also confirmed: `backend` Service exposes port `8000`, `frontend` Service exposes port `3000` (matches the Ingress rules in Task 6 Step 2 below) — `redis:7-alpine` and `nginx:alpine` (lines 89, 401) are public images and need no ECR substitution.

```yaml
# k8s/eks/patch-storageclass.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: sqlite-pvc
spec:
  storageClassName: gp3
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: media-pvc
spec:
  storageClassName: gp3
```

- [ ] **Step 2: Replace the nginx NodePort with an ALB Ingress**

```yaml
# k8s/eks/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: helpdesk-ingress
  namespace: helpdesk
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/healthcheck-path: /api/health/
spec:
  rules:
    - http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 8000
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 3000
```

Service names/ports above (`backend:8000`, `frontend:3000`) are confirmed directly against `k8s/all-in-one.yaml` — no further verification needed before applying.

- [ ] **Step 3: Build and verify the overlay locally before applying**

```bash
kubectl kustomize k8s/eks/ | less
```

Expected: full rendered manifest, `storageClassName: gp3` visible on both PVCs, `image:` fields pointing at your ECR account ID (once Task 7 sets the real account ID), an `Ingress` resource present, no `nginx` Deployment/Service (leave it in the base file, just don't route to it — or delete those two resources from `k8s/all-in-one.yaml` entirely once you've confirmed the Ingress path works end to end).

- [ ] **Step 4: Commit**

```bash
git add k8s/eks/
git commit -m "k8s: EKS overlay — gp3 storage class, ECR images, ALB Ingress"
```

---

### Task 7: Amazon ECR — build and push images

**Files:**
- Create: `infra/terraform/ecr.tf`

**Interfaces:**
- Produces: two ECR repo URIs, consumed by Task 6's Kustomize `images:` block and Task 8's CI deploy job.

- [ ] **Step 1: Define the repos in Terraform**

```hcl
# infra/terraform/ecr.tf
resource "aws_ecr_repository" "backend" {
  name                 = "helpdesk-backend"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "frontend" {
  name                 = "helpdesk-frontend"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images older than 10, keep storage cost near zero between sessions"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
```

`image_scanning_configuration { scan_on_push = true }` gives you ECR's built-in vulnerability scan on every push — free, and a nice complement to the Trivy scan already in `.github/workflows/cicd.yml`.

- [ ] **Step 2: `terraform apply`, then a manual first push to confirm auth works**

```bash
terraform apply -target=aws_ecr_repository.backend -target=aws_ecr_repository.frontend
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile helpdesk-eks)
aws ecr get-login-password --region us-east-1 --profile helpdesk-eks | \
  docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

docker build -t $ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/helpdesk-backend:manual-test -f Dockerfile.backend .
docker push $ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/helpdesk-backend:manual-test
```

Expected: push succeeds; `aws ecr describe-images --repository-name helpdesk-backend` shows the tag.

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/ecr.tf
git commit -m "infra: ECR repos with scan-on-push and a lifecycle policy capping stored images at 10"
```

---

### Task 8: GitHub Actions → AWS via OIDC (no static keys), rewrite the deploy job

**Files:**
- Create: `infra/terraform/github-oidc.tf`
- Modify: `.github/workflows/cicd.yml` — replace the "🚀 Deploy to K3s" job

**Interfaces:**
- Consumes: `module.eks.cluster_name`, ECR repo URIs from Tasks 3 and 7.

- [ ] **Step 1: Terraform for the GitHub OIDC provider + deploy role**

```hcl
# infra/terraform/github-oidc.tf
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:iam-adnan/helpdesk:*"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "helpdesk-github-actions-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_trust.json
}

resource "aws_iam_role_policy_attachment" "github_deploy_ecr" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser"
}

# Scoped to just what's needed to update the deployment via kubectl —
# actual K8s RBAC still gated separately via an aws-auth ConfigMap entry, Step 3 below.
resource "aws_iam_role_policy" "github_deploy_eks_describe" {
  name = "eks-describe-cluster"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["eks:DescribeCluster"]
      Resource = module.eks.cluster_arn
    }]
  })
}
```

- [ ] **Step 2: `terraform apply`, note the role ARN**

```bash
terraform apply -target=aws_iam_role.github_deploy
terraform output github_deploy_role_arn
```

(Add `output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }` to `outputs.tf` if not already present.)

- [ ] **Step 3: Grant that IAM role Kubernetes RBAC access via the EKS access entry API**

```bash
aws eks create-access-entry \
  --cluster-name helpdesk-eks \
  --principal-arn <github_deploy_role_arn> \
  --type STANDARD \
  --profile helpdesk-eks

aws eks associate-access-policy \
  --cluster-name helpdesk-eks \
  --principal-arn <github_deploy_role_arn> \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy \
  --access-scope type=namespace,namespaces=helpdesk \
  --profile helpdesk-eks
```

This uses the modern EKS access-entry API (not the older `aws-auth` ConfigMap edit) — scopes the CI role to edit-only access inside the `helpdesk` namespace, nothing cluster-wide.

- [ ] **Step 4: Add the GitHub repo secret/variable for the role ARN**

```bash
gh secret set AWS_DEPLOY_ROLE_ARN --body "<github_deploy_role_arn>"
gh variable set AWS_REGION --body "us-east-1"
gh variable set EKS_CLUSTER_NAME --body "helpdesk-eks"
```

- [ ] **Step 5: Replace the "🚀 Deploy to K3s" job in `.github/workflows/cicd.yml`**

```yaml
  deploy:
    name: "🚀 Deploy to EKS"
    runs-on: ubuntu-latest
    needs: [build-and-push]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v5

      - name: Configure AWS credentials via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}

      - name: Login to ECR
        run: |
          aws ecr get-login-password --region ${{ vars.AWS_REGION }} | \
            docker login --username AWS --password-stdin ${{ steps.account.outputs.id }}.dkr.ecr.${{ vars.AWS_REGION }}.amazonaws.com

      - name: Build and push images to ECR
        run: |
          ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
          ECR_REGISTRY=$ACCOUNT_ID.dkr.ecr.${{ vars.AWS_REGION }}.amazonaws.com
          docker build -t $ECR_REGISTRY/helpdesk-backend:${{ env.IMAGE_TAG }} -f Dockerfile.backend .
          docker build -t $ECR_REGISTRY/helpdesk-frontend:${{ env.IMAGE_TAG }} -f Dockerfile.frontend . --build-arg NEXT_PUBLIC_API_URL=/api
          docker push $ECR_REGISTRY/helpdesk-backend:${{ env.IMAGE_TAG }}
          docker push $ECR_REGISTRY/helpdesk-frontend:${{ env.IMAGE_TAG }}

      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name ${{ vars.EKS_CLUSTER_NAME }} --region ${{ vars.AWS_REGION }}

      - name: Deploy via Kustomize
        run: |
          ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
          cd k8s/eks
          kustomize edit set image \
            BACKEND_IMAGE_PLACEHOLDER=$ACCOUNT_ID.dkr.ecr.${{ vars.AWS_REGION }}.amazonaws.com/helpdesk-backend:${{ env.IMAGE_TAG }} \
            FRONTEND_IMAGE_PLACEHOLDER=$ACCOUNT_ID.dkr.ecr.${{ vars.AWS_REGION }}.amazonaws.com/helpdesk-frontend:${{ env.IMAGE_TAG }}
          kubectl apply -k .

      - name: Wait for rollout
        run: |
          kubectl -n helpdesk rollout status deployment/backend --timeout=180s
          kubectl -n helpdesk rollout status deployment/frontend --timeout=180s
```

This entirely replaces the existing `appleboy/ssh-action`/`appleboy/scp-action` steps — no `EC2_HOST`/`EC2_SSH_KEY` secrets needed for this path anymore (keep them only if you intend to keep the old k3s-on-EC2 path alive in parallel, which isn't necessary once EKS is validated).

- [ ] **Step 6: Update the "✅ Health Check" job** to hit the ALB's DNS name instead of `EC2_HOST:30080`

```yaml
      - name: Get ALB hostname
        id: alb
        run: |
          HOSTNAME=$(kubectl -n helpdesk get ingress helpdesk-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
          echo "hostname=$HOSTNAME" >> "$GITHUB_OUTPUT"

      - name: Check backend health
        run: |
          for i in $(seq 1 10); do
            STATUS=$(curl -sk -o /dev/null -w "%{http_code}" http://${{ steps.alb.outputs.hostname }}/api/health/ || echo "000")
            echo "Attempt $i: HTTP $STATUS"
            [ "$STATUS" = "200" ] && exit 0
            sleep 15
          done
          exit 1
```

(ALB DNS names can take a minute or two to become resolvable after first creation — the retry loop with `sleep 15` accounts for that; the previous k3s health check only slept 10s between attempts because it hit a static EC2 IP that was already live.)

- [ ] **Step 7: Commit**

```bash
git add infra/terraform/github-oidc.tf .github/workflows/cicd.yml
git commit -m "ci: replace SSH-to-EC2 k3s deploy with OIDC-authenticated EKS deploy via Kustomize"
```

---

## Testing Plan

### Task 9: Infra-level testing (before every `apply`)

- [ ] **Step 1: `terraform validate` and `terraform plan` on every change** — never `apply` blind. Read the resource-count summary line (`Plan: X to add, Y to change, Z to destroy`) and sanity-check it matches what you expect to have touched.
- [ ] **Step 2: `tfsec infra/terraform/`** before every `apply` that touches IAM or networking — catches over-broad policies and the public-subnet tradeoff so it's a conscious choice, not an accident.
- [ ] **Step 3: Cost sanity-check** — before any `apply` that adds a new billable resource type (e.g. turning `enable_nat_gateway` on), re-read the Cost Plan table above and confirm you know what it adds per hour.

### Task 10: Cluster smoke tests (after every `apply`, before deploying the app)

- [ ] **Step 1:** `kubectl get nodes` → both nodes `Ready`.
- [ ] **Step 2:** `kubectl get pods -n kube-system` → `aws-load-balancer-controller`, `ebs-csi-controller`, `metrics-server`, `coredns`, `kube-proxy` all `Running`/`1/1` or `2/2`.
- [ ] **Step 3:** `kubectl get storageclass` → `gp3` present and marked default.
- [ ] **Step 4:** `kubectl describe deployment aws-load-balancer-controller -n kube-system | grep -A5 Events` → no `FailedScheduling` or IAM permission errors (if IRSA is misconfigured, this is where it shows up, as `AccessDenied` in the controller's logs — check `kubectl logs -n kube-system deploy/aws-load-balancer-controller` too).

### Task 11: Application deployment smoke tests

- [ ] **Step 1:** `kubectl apply -k k8s/eks/` (or let the CI `deploy` job do it) → `kubectl -n helpdesk get pods` shows every Deployment (`backend`, `frontend`, `celery`, `slack-bot`, `redis`) reach `Running`, no `CrashLoopBackOff`.
- [ ] **Step 2:** `kubectl -n helpdesk get pvc` → both PVCs `Bound`, not `Pending` (confirms the `gp3` StorageClass wiring from Task 5 actually worked).
- [ ] **Step 3:** `kubectl -n helpdesk get ingress helpdesk-ingress` → `ADDRESS` column populated with an ALB hostname (can take 1-3 minutes after first apply).
- [ ] **Step 4:** `curl http://<alb-hostname>/api/health/` → `{"status": "ok", "service": "mindstorm-helpdesk"}` (per `backend/helpdesk/urls.py`'s `health_check` view).
- [ ] **Step 5:** Run the backend's real test suite (from `docs/superpowers/plans/2026-09-21-cicd-testing-slack.md`, Tasks 3–8) against a pod on the cluster, not just in CI, at least once — `kubectl -n helpdesk exec -it deploy/backend -- pytest --tb=short -q` — to confirm the deployed image behaves the same as CI's test environment (catches "works in CI, breaks in the real container" class bugs, e.g. missing env vars or file permission issues in the actual `Dockerfile.backend`).

### Task 12: Light load test (k6) — keep it short, this is billed traffic through the ALB/NAT

- [ ] **Step 1: Install k6 locally**

```bash
# Windows (winget) — adjust if using a different package manager
winget install k6 --source winget
```

- [ ] **Step 2: Write a minimal smoke/load script**

```js
// scripts/loadtest.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${__ENV.TARGET_URL}/api/health/`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```

- [ ] **Step 3: Run it against the live ALB, once**

```bash
TARGET_URL=http://<alb-hostname> k6 run scripts/loadtest.js
```

Expected: p95 latency under threshold, <1% failure rate, both thresholds reported `✓`. 10 VUs for 60s against a health-check endpoint is intentionally tiny — the point is confirming the ALB/Ingress/Service chain works under a handful of concurrent requests, not real load testing; a longer/heavier run adds LCU and data-processing cost for no real benefit at this scale.

- [ ] **Step 4: Commit the script** (not the results — those are ephemeral)

```bash
git add scripts/loadtest.js
git commit -m "test: add k6 smoke/load script for post-deploy ALB verification"
```

### Task 13: Failure-injection test

- [ ] **Step 1: Pod self-healing** — `kubectl -n helpdesk delete pod -l app=backend` → confirm a replacement pod appears and reaches `Running` within ~30-60s, and `curl /api/health/` keeps returning 200 throughout (briefly may 5xx for a few seconds since `replicas: 1` means no overlap — note this in your own testing notes as an expected single-replica limitation, not a bug).
- [ ] **Step 2: Node replacement** — `kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data` on one of the two nodes, confirm pods reschedule onto the other node (or the ASG replaces the drained node if using Spot interruption simulation — AWS's [Spot Instance interruption testing via Fault Injection Simulator](https://aws.amazon.com/fis/) is a further stretch-goal, not required here).

### Task 14: Teardown verification — the step that actually protects your $200

- [ ] **Step 1: `terraform destroy`**

```bash
cd infra/terraform
terraform plan -destroy -out=tfplan.destroy
terraform apply tfplan.destroy
```

- [ ] **Step 2: Confirm nothing billable survived the destroy** — this is the single most important test in this entire plan, because a NAT Gateway or ALB that Terraform failed to clean up (e.g. because Kubernetes created it out-of-band via the LB Controller/EBS CSI driver, which Terraform doesn't track) will keep billing silently:

```bash
aws eks list-clusters --region us-east-1 --profile helpdesk-eks
aws ec2 describe-nat-gateways --filter Name=state,Values=available --region us-east-1 --profile helpdesk-eks
aws elbv2 describe-load-balancers --region us-east-1 --profile helpdesk-eks
aws ec2 describe-volumes --filters Name=status,Values=available --region us-east-1 --profile helpdesk-eks
aws ec2 describe-instances --filters Name=instance-state-name,Values=running --region us-east-1 --profile helpdesk-eks
```

Expected: every one of these returns an empty list. **If the ALB or an EBS volume still shows up, delete it manually** (`aws elbv2 delete-load-balancer`, `aws ec2 delete-volume`) — this is the exact failure mode that happens because the ALB Controller and EBS CSI driver create AWS resources directly via the Kubernetes API, not via Terraform, so `terraform destroy` alone won't necessarily clean them up if the cluster is deleted while an `Ingress`/`PersistentVolume` is still around. **The safe order is: `kubectl delete -k k8s/eks/` first (let the controllers deprovision their ALB/EBS resources cleanly), wait ~2 minutes, confirm via the `aws` commands above that they're gone, then `terraform destroy`.**

- [ ] **Step 3: Check the Billing dashboard the next day** to confirm the spend for that session matches your estimate from the Cost Plan table — this closes the loop and calibrates your estimates for the next session.

### Task 15: Budget-alert fire test (do this once, early — Task 0 already set the real $180 threshold)

- [ ] **Step 1:** Temporarily create a second, throwaway AWS Budget with a **$1** threshold and 100% alert.
- [ ] **Step 2:** Wait for the next billing/usage refresh (budget alerts typically evaluate a few times a day, not instantly — this may take several hours) and confirm the alert email actually arrives.
- [ ] **Step 3:** Delete the $1 test budget once confirmed; leave the real $180 one from Task 0 in place permanently.

### Task 16: Monitoring — Prometheus, Grafana, Alertmanager (added after this doc's original scope)

**Files (already written, this task is verification/first-use, not authoring):**
- `infra/terraform/monitoring.tf` — `kube-prometheus-stack` Helm release
- `infra/terraform/secrets.tf` — `grafana_admin_password` (generated), `slack_webhook_url` (from `var.slack_webhook_url`)
- `k8s/eks/externalsecret-grafana.yaml`, `k8s/eks/externalsecret-alertmanager-slack.yaml`
- `k8s/eks/ingress-grafana.yaml` — Grafana's own Ingress (a separate Kubernetes object is required since Ingress backend Services must live in the same namespace as the Ingress itself, and Grafana's Service is in `monitoring` while the app's is in `helpdesk`), sharing the **same physical ALB** as `k8s/eks/ingress.yaml` via `alb.ingress.kubernetes.io/group.name: helpdesk` — this does **not** provision a second load balancer.

**Interfaces:**
- Consumes: `module.eks` (Task 3), `aws_eks_addon.ebs_csi`/`kubernetes_storage_class.gp3` (Task 5, for Prometheus's PVC), `module.external_secrets_irsa` (extended in `irsa.tf` to read the two new secret ARNs).
- Produces: Grafana reachable at `http://<alb-hostname>/grafana`; Alertmanager posting to the Slack channel the webhook points at.

- [ ] **Step 1: Set the Slack webhook variable before applying**

```bash
export TF_VAR_slack_webhook_url="https://hooks.slack.com/services/XXX/YYY/ZZZ"
```

Same value as `gh secret set SLACK_WEBHOOK_URL` from Task 12 — one webhook, two delivery paths (CI pipeline deploy-result notifications vs. Alertmanager runtime-failure notifications).

- [ ] **Step 2: Apply, then wire up ExternalSecrets, in the order that avoids any wait**

```bash
cd infra/terraform
terraform apply   # creates the AWS secrets, IRSA, and the kube-prometheus-stack Helm release itself
kubectl apply -k ../../k8s/eks/   # creates the ExternalSecrets that populate grafana-admin-credentials / alertmanager-slack-webhook
```

If you apply Terraform without the `kubectl apply -k` step run yet (or before the ExternalSecrets exist for any other reason), the Grafana/Alertmanager pods will just sit retrying `FailedMount` until the secrets show up — self-healing, no restart needed, but worth doing in this order so you're not waiting on it.

- [ ] **Step 3: Confirm the monitoring stack is healthy**

```bash
kubectl -n monitoring get pods
```

Expected: `kube-prometheus-stack-grafana`, `alertmanager-kube-prometheus-stack-alertmanager-0`, `prometheus-kube-prometheus-stack-prometheus-0`, `kube-prometheus-stack-kube-state-metrics`, `kube-prometheus-stack-operator`, and one `kube-prometheus-stack-prometheus-node-exporter` pod per node — all `Running`.

- [ ] **Step 4: Confirm Grafana loads through the shared ALB**

```bash
HOSTNAME=$(kubectl -n helpdesk get ingress helpdesk-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -sI "http://$HOSTNAME/grafana/login" | head -1
```

Expected: `HTTP/1.1 200`. Log in with username `admin` and the password from `aws secretsmanager get-secret-value --secret-id helpdesk/grafana-admin-password --query SecretString --output text` — the default "Kubernetes / Compute Resources / Node (Pods)" and "Node Exporter / Nodes" dashboards (ships with the chart, no manual import needed) should already show live data for both nodes.

- [ ] **Step 5: Update `grafana_domain` now that the ALB hostname is known**

```bash
terraform apply -var grafana_domain="$HOSTNAME"
```

(Was left at the `localhost` default in Task 16 Step 1/2 — same circularity as `cors_allowed_origins` in the Global Constraints. Without this, links inside Grafana's UI will point at the wrong host.)

- [ ] **Step 6: Verify Alertmanager actually reaches Slack — trigger a real alert**

```bash
kubectl -n helpdesk run crashloop-test --image=busybox --restart=Always -- sh -c "exit 1"
```

Expected: within a few minutes, `KubePodCrashLooping` fires (one of the chart's default rules) and a message lands in the Slack channel the webhook points at. Clean up afterward:

```bash
kubectl -n helpdesk delete pod crashloop-test
```

- [ ] **Step 7: Confirm the crashloop test pod's resolution also notifies Slack** (the receiver config sets `send_resolved: true`) — after Step 6's delete, expect a second Slack message noting the alert resolved. If it doesn't arrive within `group_interval` (5m per `monitoring.tf`'s config), check `kubectl -n monitoring logs -l app.kubernetes.io/name=alertmanager` for delivery errors (most likely cause: `alertmanager-slack-webhook`'s `slack_url` key doesn't match what Step 2 actually synced — re-check `externalsecret-alertmanager-slack.yaml`'s `secretKey` against `monitoring.tf`'s `api_url_file` path, they must agree exactly).

---

## Self-Review Notes

- **Spec coverage:** "whole process" → Tasks 1–8 (IAM bootstrap through CI/CD rewire). "testing" → Tasks 9–15 (infra validation, cluster/app smoke tests, load test, failure injection, teardown verification, budget-alert test). "AWS plan we can use in our account" → the Cost Plan table + Global Constraints section, grounded in current (2026) pricing with sources cited inline. "list of all the tools" → the Tool List table. "Grafana/Prometheus for node health and stats, Slack for failure/deployment notifications" (added after the doc's original scope) → Task 16 for Prometheus/Grafana/Alertmanager; deployment-event Slack notifications were already covered by Task 12's CI pipeline `notify`/`notify-pr` jobs — Task 16 adds the separate runtime-failure path (Alertmanager -> Slack) rather than duplicating what CI already does.
- **Verification pass completed during planning, not left as an assumption:** `grep -n "image:"` and the `kind: Service` blocks in `k8s/all-in-one.yaml` were both read directly. Confirmed: `backend`/`frontend` Service ports are `8000`/`3000` (used as-is in Task 6's `Ingress`), and every backend-family Deployment (`backend`, `celery`, `slack-bot`) uses the literal token `BACKEND_IMAGE_PLACEHOLDER` while `frontend` uses `FRONTEND_IMAGE_PLACEHOLDER` — these are pre-existing substitution tokens the old k3s `sed`/`kubectl set image` deploy step filled in, not real Docker Hub refs, so Task 6/8's Kustomize `images:` block targets those exact strings rather than a guessed `DOCKERHUB_USERNAME/...` name.
- **Deliberately out of scope:** migrating off SQLite to RDS (mentioned only as a Task 0 credit-farming step, not a real dependency change — the app keeps using SQLite-on-EBS exactly as it does on k3s today), Karpenter/cluster-autoscaler (the fixed 2-node group is intentionally simple for a budget-capped learning cluster), multi-environment (dev/staging/prod) clusters (each additional cluster is another fixed $73/mo control-plane fee — not worth it inside a $200 one-time credit), and a custom domain/ACM certificate for HTTPS on the ALB (the ALB's default DNS name over HTTP is sufficient for testing; adding a Route53 hosted zone + ACM cert is a cheap but not-strictly-necessary follow-up once a domain is available).
- **Portfolio note:** this plan was deliberately built with Terraform (not `eksctl`/console clicks) and OIDC-federated CI (not static AWS keys) specifically because those are the patterns that show up in cloud/DevOps interview screens — worth calling out explicitly in a resume/portfolio writeup once this is running: "Provisioned and tore down an EKS cluster via Terraform, wired GitHub Actions to deploy via IAM OIDC federation with zero long-lived credentials, and operated it under a hard cost budget using AWS Budgets alerts."
