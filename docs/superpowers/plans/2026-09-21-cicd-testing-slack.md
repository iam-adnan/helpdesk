# Helpdesk CI/CD Repair, Test Suite, and Slack Trigger Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the existing GitHub Actions pipeline actually passing on real work (not trivially green), add a real backend + frontend automated test suite with coverage wired into Sonar, and replace the email-only pipeline notification with a Slack notification so the team hears about build/deploy triggers in real time.

**Architecture:** The pipeline (`.github/workflows/cicd.yml`) already has the right shape — test → SonarCloud → Trivy → build/push → deploy to k3s → health check → notify — but it has never successfully run past "Frontend Tests" because `frontend/package-lock.json` was never committed, so `npm ci` fails immediately. The "Backend Tests" job that shows green is a false positive: there are zero test files anywhere in `backend/`, so pytest/`manage.py test` collect 0 tests and exit 0. We fix the pipeline's actual defect first (Task 1), then add real `pytest-django` tests per Django app and a Jest/RTL setup for the frontend so the test jobs do real work, then tighten the CI test steps so a real failure can no longer be masked, and finally add a Slack notification step driven by an incoming webhook.

**Tech Stack:** Django 5.0.6 / DRF 3.15.1 / Python 3.11 / SQLite (file DB via `DATABASE_PATH`) on the backend; Next.js 14.2.4 (App Router) / React 18.3.1 / TypeScript 5.4.5 / Zustand on the frontend; GitHub Actions, Docker Hub, SonarCloud, Trivy, k3s-on-EC2 for CI/CD.

**Spec:** No separate spec doc — this plan is derived directly from auditing `C:\Users\Adnan\Desktop\mindstorm-helpdesk\helpdesk` (the copy whose `main` HEAD matches `origin/main`) on 2026-09-21. Findings are folded into the task descriptions below.

## Global Constraints

- Work happens in `C:\Users\Adnan\Desktop\mindstorm-helpdesk\helpdesk` — this is the checkout that matches `origin/main` (verified via `git ls-remote`). Do **not** use `C:\Users\Adnan\helpdesk` or any of the `Downloads\mindstorm-helpdesk-*` copies; they are stale/duplicate snapshots.
- `AUTH_USER_MODEL = 'accounts.User'`, `ALLOWED_EMAIL_DOMAIN = 'mindstormstudios.com'`, `DJANGO_SETTINGS_MODULE = helpdesk.settings` (from `backend/helpdesk/settings.py`).
- Backend apps: `accounts`, `tickets`, `notifications`, `integrations`, `reports`, `settings_manager`. None currently have a `tests.py`/`tests/` package.
- Frontend has no test runner installed at all (no jest/vitest/testing-library in `package.json`, no config file).
- GitHub Actions secrets already configured on `iam-adnan/helpdesk` (confirmed via `gh secret list`): `DOCKERHUB_TOKEN`, `DOCKERHUB_USERNAME`, `EC2_HOST`, `EC2_SSH_KEY`, `EMAIL_PASSWORD`, `EMAIL_USERNAME`, `NOTIFY_EMAIL`, `SONAR_ORGANIZATION`, `SONAR_PROJECT_KEY`, `SONAR_TOKEN`. A new `SLACK_WEBHOOK_URL` secret must be added for Task 12 (needs a human with repo admin + a Slack workspace admin to create the webhook — flag this, don't try to create it yourself).
- Only one pipeline run has ever happened (`gh run list`): 2026-04-08, `failure`, died in "🧪 Frontend Tests". Everything after that job (Sonar, Trivy, build/push, deploy, health check) has never actually executed once.
- Existing app-level Slack bot (`backend/slack_bot.py`, `backend/slack_bridge.py`, `integrations/` app) creates/updates *tickets* from Slack — that is a separate, already-working feature. This plan's "Slack integration for the triggers" is specifically about **CI/CD pipeline notifications** (push/build/deploy events), not the ticket bot. Do not touch `slack_bot.py`/`slack_bridge.py`/`integrations/slack_views.py` in this plan.
- Run backend tests with `CELERY_TASK_ALWAYS_EAGER=True` so `.delay()` calls execute synchronously instead of needing a live Redis broker in CI. All existing Celery tasks (`notifications/tasks.py`, `integrations/tasks.py`) already wrap their bodies in `try/except` and no-op when `AppSetting` values (Slack token, SMTP host, Anthropic key) are unset, so eager execution is safe without any secrets configured.

---

## File Structure

**Backend (new files):**
- `backend/pytest.ini` — pytest-django config
- `backend/helpdesk/conftest.py` — nothing app-specific goes here; per-app fixtures live in each app's own `conftest.py` where needed
- `backend/accounts/tests.py` — model + serializer + API tests for `User`
- `backend/tickets/tests.py` — model + viewset tests for `Ticket`
- `backend/notifications/tests.py` — `Notification`/`NotificationTemplate` + viewset tests
- `backend/settings_manager/tests.py` — `AppSetting` get/set tests
- `backend/reports/tests.py` — `DashboardStatsView` permission + shape tests
- `backend/integrations/tests.py` — `SlackInstallation` model smoke test
- `backend/.coveragerc` — coverage scope (excludes migrations/tests/settings)

**Frontend (new files):**
- `frontend/jest.config.js`, `frontend/jest.setup.js`
- `frontend/src/lib/__tests__/auth.test.ts`
- `frontend/src/lib/__tests__/api.test.ts`
- `frontend/package-lock.json` (generated, committed — this is the actual pipeline fix)

**CI (modified):**
- `.github/workflows/cicd.yml` — fix action versions, stop masking test failures, add frontend coverage generation, add Slack notify step
- `sonar-project.properties` — fix placeholder org

---

### Task 1: Fix the actual CI/CD breakage (missing lockfile + stale action versions)

**Files:**
- Create: `frontend/package-lock.json`
- Modify: `.github/workflows/cicd.yml`

**Interfaces:**
- Produces: a `frontend/package-lock.json` that `npm ci` can consume; no code interfaces (infra-only task).

This is the actual root cause of the one and only pipeline run failing: `npm ci` in the `test-frontend` job requires an existing, checked-in `package-lock.json` and fails immediately if it's absent. It was never committed. The build itself is fine — `npm run build` succeeds locally once dependencies are installed (verified during this audit).

- [ ] **Step 1: Generate and commit the frontend lockfile**

```bash
cd frontend
npm install --no-audit --no-fund
cd ..
git add frontend/package-lock.json
git commit -m "fix(ci): commit frontend package-lock.json so npm ci works"
```

- [ ] **Step 2: Verify `npm ci` now works from a clean state**

```bash
cd frontend
rm -rf node_modules
npm ci
npm run build
cd ..
```

Expected: both commands exit 0, `Compiled successfully` appears in the build output.

- [ ] **Step 3: Pin GitHub Actions to Node 24-compatible versions**

The one run we have shows this annotation on `actions/checkout@v4` and `actions/setup-node@v4`:

> Node.js 20 actions are deprecated... Node.js 20 will be removed from the runner on September 16th, 2026.

That removal date has already passed as of today (2026-09-21), so these actions may now be running on a forced Node 24 shim or failing outright. Bump every pinned action major version in `.github/workflows/cicd.yml` to its current latest major (checked against the GitHub Marketplace at execution time — at minimum `actions/checkout@v5`, `actions/setup-python@v6`, `actions/setup-node@v5`, `actions/upload-artifact@v5`, `actions/download-artifact@v5`). Do this as a single find/replace pass across the file; the job logic does not change.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/cicd.yml
git commit -m "fix(ci): bump GitHub Actions to current major versions"
```

- [ ] **Step 5: Push a throwaway branch and confirm the pipeline gets past Frontend Tests**

```bash
git checkout -b ci/verify-lockfile-fix
git push -u origin ci/verify-lockfile-fix
gh pr create --title "ci: verify lockfile + action version fix" --body "Verification-only PR for the CI audit fix." --base main
gh pr checks --watch
```

Expected: `🧪 Frontend Tests` now passes (or fails on something new and real, not `npm ci`). Close/delete the PR and branch once confirmed — this step is just to get a real CI run, not to ship anything yet. Do this again at the end of the plan (Task 13) once everything else lands.

---

### Task 2: Backend test tooling (pytest-django, coverage scope, Celery eager mode)

**Files:**
- Create: `backend/pytest.ini`
- Create: `backend/.coveragerc`
- Modify: `backend/helpdesk/settings.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Produces: `pytest` runnable from `backend/` with Django wired up automatically (no more manual `makemigrations`/`migrate`/env-var dance duplicated in CI and locally); `CELERY_TASK_ALWAYS_EAGER` setting other tasks read from `django.conf.settings`.

- [ ] **Step 1: Add test dependencies**

Add to `backend/requirements.txt`:

```
pytest-django==4.9.0
pytest-cov==5.0.0
factory-boy==3.3.1
```

- [ ] **Step 2: Add pytest-django config**

Create `backend/pytest.ini`:

```ini
[pytest]
DJANGO_SETTINGS_MODULE = helpdesk.settings
python_files = tests.py test_*.py
addopts = --reuse-db --nomigrations
```

`--nomigrations` (via `pytest-django`'s built-in support, no extra plugin needed) makes the test DB build straight from models instead of replaying every migration — this is what removes the need for the `makemigrations ... && migrate` dance currently hardcoded into the CI step.

- [ ] **Step 3: Add coverage scope config**

Create `backend/.coveragerc`:

```ini
[run]
source = accounts,tickets,notifications,integrations,reports,settings_manager
omit =
    */migrations/*
    */tests.py
    */admin.py
    */apps.py
    manage.py
    helpdesk/wsgi.py
    helpdesk/asgi.py

[report]
exclude_lines =
    pragma: no cover
    raise NotImplementedError
```

- [ ] **Step 4: Make Celery eager in tests without changing prod behavior**

In `backend/helpdesk/settings.py`, find the existing Celery block:

```python
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://redis:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://redis:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
```

Add directly below it:

```python
CELERY_TASK_ALWAYS_EAGER = os.environ.get('CELERY_TASK_ALWAYS_EAGER', 'False') == 'True'
CELERY_TASK_EAGER_PROPAGATES = False
```

`CELERY_TASK_EAGER_PROPAGATES = False` matters here specifically because every existing task body already swallows its own exceptions (see `notifications/tasks.py`, `integrations/tasks.py`) — we don't want eager mode to start re-raising things those tasks intentionally log-and-ignore.

- [ ] **Step 5: Install and verify pytest collects (0 tests is fine at this point — we're checking wiring, not coverage)**

```bash
cd backend
pip install -r requirements.txt
mkdir -p data && touch data/helpdesk.log
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
export CELERY_TASK_ALWAYS_EAGER=True
pytest --collect-only
```

Expected: exits 0 (or the "no tests collected" exit 5, since Task 3 hasn't added any test files yet — either is fine here, we're only checking Django boots and settings load without error).

- [ ] **Step 6: Commit**

```bash
git add backend/pytest.ini backend/.coveragerc backend/requirements.txt backend/helpdesk/settings.py
git commit -m "test(backend): add pytest-django tooling, coverage scope, Celery eager-test mode"
```

---

### Task 3: `accounts` app tests

**Files:**
- Create: `backend/accounts/tests.py`

**Interfaces:**
- Consumes: `accounts.models.User` (`Role` choices `admin`/`agent`/`user`, auto-admin-on-first-user in `save()`, email lowercasing, username auto-dedup), `accounts.serializers.UserCreateSerializer` (`validate_email` enforces `ALLOWED_EMAIL_DOMAIN`), URLs from `accounts/urls.py`: `POST /api/auth/register/`, `POST /api/auth/login/`, `GET/PATCH /api/auth/profile/`, `POST /api/auth/change-password/`, `/api/auth/admin/users/` (`AdminUserViewSet`, gated by `IsAdmin`).

This is the highest-value app to cover first: it gates every other endpoint via JWT + role, and its `User.save()` has non-obvious behavior (first user in the whole system silently becomes admin/staff/superuser) that is exactly the kind of thing a future change could break unnoticed.

- [ ] **Step 1: Write the test file**

```python
# backend/accounts/tests.py
from django.test import TestCase
from rest_framework.test import APITestCase
from rest_framework import status
from .models import User


class UserModelTests(TestCase):
    def test_first_user_becomes_admin(self):
        user = User.objects.create_user(
            username='first', email='first@mindstormstudios.com', password='pw12345678'
        )
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)

    def test_second_user_is_not_admin(self):
        User.objects.create_user(username='first', email='first@mindstormstudios.com', password='pw12345678')
        second = User.objects.create_user(username='second', email='second@mindstormstudios.com', password='pw12345678')
        self.assertEqual(second.role, User.Role.USER)
        self.assertFalse(second.is_staff)

    def test_email_is_lowercased_on_save(self):
        user = User.objects.create_user(username='mixed', email='MiXeD@MindstormStudios.com', password='pw12345678')
        self.assertEqual(user.email, 'mixed@mindstormstudios.com')

    def test_username_auto_dedup(self):
        User.objects.create_user(username='dupe', email='dupe@mindstormstudios.com', password='pw12345678')
        second = User(email='dupe2@mindstormstudios.com')
        second.username = ''
        second.set_password('pw12345678')
        second.save()
        # falls back to email-local-part-based generation since username was blank
        self.assertTrue(second.username)

    def test_is_agent_true_for_admin_and_agent(self):
        admin = User(role=User.Role.ADMIN)
        agent = User(role=User.Role.AGENT)
        plain = User(role=User.Role.USER)
        self.assertTrue(admin.is_agent)
        self.assertTrue(agent.is_agent)
        self.assertFalse(plain.is_agent)


class RegisterViewTests(APITestCase):
    def test_register_rejects_wrong_domain(self):
        resp = self.client.post('/api/auth/register/', {
            'email': 'someone@gmail.com', 'username': 'someone',
            'password': 'pw12345678', 'password_confirm': 'pw12345678',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_allows_allowed_domain_and_returns_tokens(self):
        resp = self.client.post('/api/auth/register/', {
            'email': 'newagent@mindstormstudios.com', 'username': 'newagent',
            'password': 'pw12345678', 'password_confirm': 'pw12345678',
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn('tokens', resp.data)
        self.assertIn('access', resp.data['tokens'])

    def test_register_rejects_mismatched_passwords(self):
        resp = self.client.post('/api/auth/register/', {
            'email': 'mismatch@mindstormstudios.com', 'username': 'mismatch',
            'password': 'pw12345678', 'password_confirm': 'different',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_rejects_duplicate_email(self):
        User.objects.create_user(username='existing', email='existing@mindstormstudios.com', password='pw12345678')
        resp = self.client.post('/api/auth/register/', {
            'email': 'existing@mindstormstudios.com', 'username': 'existing2',
            'password': 'pw12345678', 'password_confirm': 'pw12345678',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class LoginViewTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='loginuser', email='loginuser@mindstormstudios.com', password='correct-pw123'
        )

    def test_login_success(self):
        resp = self.client.post('/api/auth/login/', {'email': 'loginuser@mindstormstudios.com', 'password': 'correct-pw123'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp.data['tokens'])

    def test_login_wrong_password(self):
        resp = self.client.post('/api/auth/login/', {'email': 'loginuser@mindstormstudios.com', 'password': 'wrong'})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_unknown_email(self):
        resp = self.client.post('/api/auth/login/', {'email': 'nobody@mindstormstudios.com', 'password': 'whatever123'})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_disabled_account(self):
        self.user.is_active = False
        self.user.save()
        resp = self.client.post('/api/auth/login/', {'email': 'loginuser@mindstormstudios.com', 'password': 'correct-pw123'})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class AdminUserViewSetPermissionTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin1', email='admin1@mindstormstudios.com', password='pw12345678')
        self.plain = User.objects.create_user(username='plain1', email='plain1@mindstormstudios.com', password='pw12345678')
        # admin1 is the FIRST user, so it's auto-admin; make plain1 explicitly non-admin to be sure
        self.plain.role = User.Role.USER
        self.plain.is_staff = False
        self.plain.save()

    def test_non_admin_cannot_list_users(self):
        self.client.force_authenticate(self.plain)
        resp = self.client.get('/api/auth/admin/users/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_list_users(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/auth/admin/users/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_admin_set_role(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/auth/admin/users/{self.plain.id}/set_role/', {'role': 'agent'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.plain.refresh_from_db()
        self.assertEqual(self.plain.role, 'agent')

    def test_admin_set_invalid_role_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/auth/admin/users/{self.plain.id}/set_role/', {'role': 'superhero'})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
```

- [ ] **Step 2: Run and confirm all pass**

```bash
cd backend
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
export CELERY_TASK_ALWAYS_EAGER=True
pytest accounts/tests.py -v
```

Expected: all tests pass (green). If `test_register_allows_allowed_domain_and_returns_tokens` fails on username collision, it means an earlier test left state — check `--reuse-db` isn't reusing a dirty DB from a manual run; `pytest-django` wraps each test in a transaction, so this should not happen inside a clean run.

- [ ] **Step 3: Commit**

```bash
git add backend/accounts/tests.py
git commit -m "test(accounts): cover User model, register, login, admin viewset permissions"
```

---

### Task 4: `tickets` app tests

**Files:**
- Create: `backend/tickets/tests.py`

**Interfaces:**
- Consumes: `accounts.models.User`, `tickets.models.Ticket` (`ticket_number` auto-increments as `MS-00001`, `MS-00002`, ...), `TicketViewSet.get_queryset()` (agents/admins see all tickets, plain users see only their own), custom actions `comment`, `assign`, `stats` on `/api/tickets/{id}/...` and `/api/tickets/stats/`.

- [ ] **Step 1: Write the test file**

```python
# backend/tickets/tests.py
from django.test import TestCase
from rest_framework.test import APITestCase
from rest_framework import status
from accounts.models import User
from .models import Ticket


class TicketModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='reporter', email='reporter@mindstormstudios.com', password='pw12345678')

    def test_ticket_number_auto_increments(self):
        t1 = Ticket.objects.create(subject='First issue', created_by=self.user)
        t2 = Ticket.objects.create(subject='Second issue', created_by=self.user)
        self.assertEqual(t1.ticket_number, 'MS-00001')
        self.assertEqual(t2.ticket_number, 'MS-00002')

    def test_default_status_and_priority(self):
        t = Ticket.objects.create(subject='Defaults check', created_by=self.user)
        self.assertEqual(t.status, Ticket.Status.OPEN)
        self.assertEqual(t.priority, Ticket.Priority.MEDIUM)


class TicketViewSetTests(APITestCase):
    def setUp(self):
        # First user created anywhere in the suite becomes admin (see accounts.User.save);
        # to keep this file independent of test ordering, create+fix roles explicitly.
        self.admin = User.objects.create_user(username='tadmin', email='tadmin@mindstormstudios.com', password='pw12345678')
        self.admin.role = User.Role.ADMIN
        self.admin.is_staff = True
        self.admin.save()

        self.agent = User.objects.create_user(username='tagent', email='tagent@mindstormstudios.com', password='pw12345678')
        self.agent.role = User.Role.AGENT
        self.agent.save()

        self.owner = User.objects.create_user(username='towner', email='towner@mindstormstudios.com', password='pw12345678')
        self.owner.role = User.Role.USER
        self.owner.save()

        self.other = User.objects.create_user(username='tother', email='tother@mindstormstudios.com', password='pw12345678')
        self.other.role = User.Role.USER
        self.other.save()

        self.owner_ticket = Ticket.objects.create(subject='Owner ticket', created_by=self.owner)
        self.other_ticket = Ticket.objects.create(subject='Other ticket', created_by=self.other)

    def test_plain_user_sees_only_own_tickets(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.get('/api/tickets/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {t['id'] for t in resp.data['results']} if 'results' in resp.data else {t['id'] for t in resp.data}
        self.assertIn(str(self.owner_ticket.id), ids)
        self.assertNotIn(str(self.other_ticket.id), ids)

    def test_agent_sees_all_tickets(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get('/api/tickets/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        count = resp.data['count'] if 'count' in resp.data else len(resp.data)
        self.assertEqual(count, 2)

    def test_create_ticket_sets_created_by_and_logs_activity(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post('/api/tickets/', {'subject': 'New problem', 'priority': 'high', 'category': 'problem'})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        ticket = Ticket.objects.get(id=resp.data['id'])
        self.assertEqual(ticket.created_by, self.owner)
        self.assertEqual(ticket.activities.filter(action='created').count(), 1)

    def test_comment_action_requires_content(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/comment/', {'content': ''})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_comment_action_creates_comment(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/comment/', {'content': 'Any update?'})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.owner_ticket.comments.count(), 1)

    def test_assign_action_moves_open_to_in_progress(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/assign/', {'agent_id': str(self.agent.id)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.owner_ticket.refresh_from_db()
        self.assertEqual(self.owner_ticket.assigned_to, self.agent)
        self.assertEqual(self.owner_ticket.status, 'in_progress')

    def test_assign_action_unknown_agent(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/assign/', {'agent_id': '00000000-0000-0000-0000-000000000000'})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_stats_action_counts_by_status(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get('/api/tickets/stats/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total'], 2)
        self.assertEqual(resp.data['open'], 2)

    def test_update_to_resolved_sets_resolved_at(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.patch(f'/api/tickets/{self.owner_ticket.id}/', {'status': 'resolved'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.owner_ticket.refresh_from_db()
        self.assertIsNotNone(self.owner_ticket.resolved_at)

    def test_anonymous_cannot_access_tickets(self):
        resp = self.client.get('/api/tickets/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
```

- [ ] **Step 2: Run and confirm all pass**

```bash
cd backend
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
export CELERY_TASK_ALWAYS_EAGER=True
pytest tickets/tests.py -v
```

Expected: all green (`/api/tickets/` is confirmed correct against `backend/helpdesk/urls.py`).

- [ ] **Step 3: Commit**

```bash
git add backend/tickets/tests.py
git commit -m "test(tickets): cover ticket numbering, queryset scoping, comment/assign/stats actions"
```

---

### Task 5: `notifications` app tests

**Files:**
- Create: `backend/notifications/tests.py`

**Interfaces:**
- Consumes: `notifications.models.Notification`, `NotificationViewSet` (`ReadOnlyModelViewSet`, scoped to `request.user`, plus `mark_read`/`mark_all_read`/`unread_count` actions), mounted at `/api/notifications/` (adjust if the project urls.py mounts it elsewhere).

- [ ] **Step 1: Write the test file**

```python
# backend/notifications/tests.py
from rest_framework.test import APITestCase
from rest_framework import status
from accounts.models import User
from .models import Notification


class NotificationViewSetTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='notifuser', email='notifuser@mindstormstudios.com', password='pw12345678')
        self.other = User.objects.create_user(username='notifother', email='notifother@mindstormstudios.com', password='pw12345678')
        self.n1 = Notification.objects.create(user=self.user, title='Ticket update', message='msg', channel='email')
        self.n2 = Notification.objects.create(user=self.other, title='Not yours', message='msg', channel='email')

    def test_user_only_sees_own_notifications(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get('/api/notifications/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {n['id'] for n in (resp.data['results'] if 'results' in resp.data else resp.data)}
        self.assertIn(str(self.n1.id), ids)
        self.assertNotIn(str(self.n2.id), ids)

    def test_mark_read(self):
        self.client.force_authenticate(self.user)
        resp = self.client.post(f'/api/notifications/{self.n1.id}/mark_read/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.n1.refresh_from_db()
        self.assertTrue(self.n1.read)

    def test_mark_all_read(self):
        Notification.objects.create(user=self.user, title='Second', message='msg', channel='email')
        self.client.force_authenticate(self.user)
        resp = self.client.post('/api/notifications/mark_all_read/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(Notification.objects.filter(user=self.user, read=False).count(), 0)

    def test_unread_count(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get('/api/notifications/unread_count/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['count'], 1)
```

- [ ] **Step 2: Run and confirm all pass**

```bash
cd backend
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
export CELERY_TASK_ALWAYS_EAGER=True
pytest notifications/tests.py -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/notifications/tests.py
git commit -m "test(notifications): cover per-user scoping, mark_read, mark_all_read, unread_count"
```

---

### Task 6: `settings_manager` app tests

**Files:**
- Create: `backend/settings_manager/tests.py`

**Interfaces:**
- Consumes: `settings_manager.models.AppSetting` (`AppSetting.get(key, default)`, `AppSetting.set(key, value)`), used by every Celery task (`slack_bot_token`, `smtp_host`, `anthropic_api_key`, etc.) as their single source of runtime config.

- [ ] **Step 1: Write the test file**

```python
# backend/settings_manager/tests.py
from django.test import TestCase
from .models import AppSetting


class AppSettingTests(TestCase):
    def test_get_returns_default_when_missing(self):
        self.assertEqual(AppSetting.get('does_not_exist', 'fallback'), 'fallback')

    def test_set_then_get_roundtrip(self):
        AppSetting.set('slack_bot_token', 'xoxb-test-token')
        self.assertEqual(AppSetting.get('slack_bot_token'), 'xoxb-test-token')

    def test_set_is_upsert(self):
        AppSetting.set('ai_enabled', 'true')
        AppSetting.set('ai_enabled', 'false')
        self.assertEqual(AppSetting.get('ai_enabled'), 'false')
        self.assertEqual(AppSetting.objects.filter(key='ai_enabled').count(), 1)
```

- [ ] **Step 2: Run and confirm all pass**

```bash
cd backend
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
pytest settings_manager/tests.py -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/settings_manager/tests.py
git commit -m "test(settings_manager): cover AppSetting get/set upsert behavior"
```

---

### Task 7: `reports` app tests

**Files:**
- Create: `backend/reports/tests.py`

**Interfaces:**
- Consumes: `reports.views.DashboardStatsView` (`GET /api/reports/dashboard/` — check exact path in `backend/helpdesk/urls.py`/`reports/urls.py`; gated by `IsAgentOrAdmin`), `accounts.models.User`, `tickets.models.Ticket`.

- [ ] **Step 1: Write the test file**

```python
# backend/reports/tests.py
from rest_framework.test import APITestCase
from rest_framework import status
from accounts.models import User
from tickets.models import Ticket


class DashboardStatsViewTests(APITestCase):
    def setUp(self):
        self.agent = User.objects.create_user(username='ragent', email='ragent@mindstormstudios.com', password='pw12345678')
        self.agent.role = User.Role.AGENT
        self.agent.save()
        self.plain = User.objects.create_user(username='rplain', email='rplain@mindstormstudios.com', password='pw12345678')
        self.plain.role = User.Role.USER
        self.plain.save()
        Ticket.objects.create(subject='One', created_by=self.plain, status='open', priority='high')
        Ticket.objects.create(subject='Two', created_by=self.plain, status='resolved', priority='low')

    def test_plain_user_forbidden(self):
        self.client.force_authenticate(self.plain)
        resp = self.client.get('/api/reports/dashboard/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_agent_gets_stats_shape(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get('/api/reports/dashboard/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total_tickets'], 2)
        for key in ('status_breakdown', 'priority_breakdown', 'category_breakdown', 'daily_tickets', 'agent_performance'):
            self.assertIn(key, resp.data)
```

- [ ] **Step 2: Run, fixing the URL path if it 404s**

```bash
cd backend
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
pytest reports/tests.py -v
```

Expected: all green (`/api/reports/dashboard/` is confirmed correct against `backend/helpdesk/urls.py` + `reports/urls.py`).

- [ ] **Step 3: Commit**

```bash
git add backend/reports/tests.py
git commit -m "test(reports): cover dashboard stats permission and response shape"
```

---

### Task 8: `integrations` app smoke test

**Files:**
- Create: `backend/integrations/tests.py`

**Interfaces:**
- Consumes: `integrations.models.SlackInstallation`.

Kept intentionally light: the interesting logic in this app is Slack Socket Mode event handling (`slack_views.py`) which needs a mocked Slack signature/request and is lower value to cover right now than the model layer everything else depends on. A model-level smoke test still gives a regression tripwire and establishes the pattern for whoever picks this up next.

- [ ] **Step 1: Write the test file**

```python
# backend/integrations/tests.py
from django.test import TestCase
from .models import SlackInstallation


class SlackInstallationModelTests(TestCase):
    def test_str_returns_team_name(self):
        install = SlackInstallation.objects.create(
            team_id='T12345', team_name='Mindstorm Studios',
            bot_token='xoxb-fake', channel_id='C123', channel_name='helpdesk',
        )
        self.assertEqual(str(install), 'Mindstorm Studios')

    def test_team_id_is_unique(self):
        SlackInstallation.objects.create(team_id='T999', team_name='A', bot_token='x')
        with self.assertRaises(Exception):
            SlackInstallation.objects.create(team_id='T999', team_name='B', bot_token='y')
```

- [ ] **Step 2: Run and confirm all pass**

```bash
cd backend
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
pytest integrations/tests.py -v
```

- [ ] **Step 3: Commit**

```bash
git add backend/integrations/tests.py
git commit -m "test(integrations): smoke-test SlackInstallation model"
```

---

### Task 9: Full backend suite + coverage sanity check

**Files:** none new — verification task.

- [ ] **Step 1: Run the entire backend suite with coverage exactly as CI will**

```bash
cd backend
export DATABASE_PATH=data/test.sqlite3
export SECRET_KEY=test-secret-key
export CELERY_TASK_ALWAYS_EAGER=True
pytest --cov --cov-report=term-missing --cov-report=xml
```

Expected: all tests from Tasks 3–8 pass together (watch for cross-test pollution now that `accounts`, `tickets`, `notifications`, `reports` all create `User` rows — `pytest-django` wraps each test in its own transaction, so this should be a non-issue, but confirm it explicitly here rather than assuming). `coverage.xml` is produced and non-trivial (`accounts`, `tickets` should show real percentages now, not 0%).

- [ ] **Step 2: No commit needed** — this step is verification only, confirming Task 2–8's work is coherent as a whole before wiring it into CI in Task 11.

---

### Task 10: Frontend test tooling + first real tests (Jest + Testing Library)

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/jest.config.js`
- Create: `frontend/jest.setup.js`
- Create: `frontend/src/lib/__tests__/auth.test.ts`
- Create: `frontend/src/lib/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `frontend/src/lib/auth.ts` (`useAuth` zustand store: `login`, `register`, `logout`, `loadUser`), `frontend/src/lib/api.ts` (axios instance with request/response interceptors — token attach, 401 refresh, network-error normalization).

The frontend has zero UI components outside `src/app/**/page.tsx` (no shared `src/components` files exist yet), so the two `src/lib` modules are the best first testing targets: they're pure-ish, already used everywhere, and their token-refresh/network-error logic in `api.ts` is exactly the kind of thing that silently breaks and is hard to notice by hand.

- [ ] **Step 1: Add test dependencies**

```bash
cd frontend
npm install --save-dev jest@29 jest-environment-jsdom@29 @testing-library/react@16 @testing-library/jest-dom@6 @types/jest@29 ts-node@10
```

- [ ] **Step 2: Add the test script and Jest config**

In `frontend/package.json`, add to `"scripts"`:

```json
"test": "jest",
"test:coverage": "jest --coverage"
```

Create `frontend/jest.config.js`:

```js
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/lib/**/*.{ts,tsx}',
    '!src/lib/types.ts',
  ],
  coverageReporters: ['text', 'lcov'],
});
```

`next/jest` (bundled with `next@14.2.4`, already in `package.json`) handles the SWC transform and module-alias resolution for you — no separate `ts-jest`/`babel-jest` config needed.

Create `frontend/jest.setup.js`:

```js
import '@testing-library/jest-dom';
```

- [ ] **Step 3: Write `auth.ts` store tests**

```ts
// frontend/src/lib/__tests__/auth.test.ts
import { useAuth } from '../auth';
import api from '../api';

jest.mock('../api');
const mockedApi = api as jest.Mocked<typeof api>;

describe('useAuth store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuth.setState({ user: null, loading: true });
    jest.clearAllMocks();
  });

  it('login stores tokens/user and updates state', async () => {
    mockedApi.post.mockResolvedValueOnce({
      data: { tokens: { access: 'a', refresh: 'r' }, user: { id: '1', email: 'x@mindstormstudios.com' } },
    } as any);

    await useAuth.getState().login('x@mindstormstudios.com', 'pw');

    expect(localStorage.getItem('tokens')).toContain('access');
    expect(useAuth.getState().user?.email).toBe('x@mindstormstudios.com');
  });

  it('login throws when server response is missing tokens', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: {} } as any);
    await expect(useAuth.getState().login('x@mindstormstudios.com', 'pw')).rejects.toThrow('Invalid server response.');
  });

  it('logout clears storage and state', () => {
    localStorage.setItem('tokens', '{}');
    localStorage.setItem('user', '{}');
    useAuth.setState({ user: { id: '1' } as any });

    // jsdom throws on navigation; stub it out for this test
    delete (window as any).location;
    (window as any).location = { href: '' };

    useAuth.getState().logout();

    expect(localStorage.getItem('tokens')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('loadUser recovers a valid stored user', () => {
    localStorage.setItem('user', JSON.stringify({ id: '2', email: 'y@mindstormstudios.com' }));
    useAuth.getState().loadUser();
    expect(useAuth.getState().user?.email).toBe('y@mindstormstudios.com');
    expect(useAuth.getState().loading).toBe(false);
  });

  it('loadUser clears corrupted storage instead of throwing', () => {
    localStorage.setItem('user', '{not-json');
    useAuth.getState().loadUser();
    expect(useAuth.getState().user).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});
```

- [ ] **Step 4: Write `api.ts` interceptor tests**

```ts
// frontend/src/lib/__tests__/api.test.ts
import api from '../api';

describe('api response interceptor', () => {
  it('normalizes a network error (no response) into a friendly message', async () => {
    const handler = (api.interceptors.response as any).handlers[0].rejected;
    await expect(handler({})).rejects.toMatchObject({
      response: { status: 0, data: { detail: expect.stringContaining('Cannot connect to server') } },
    });
  });

  it('converts an HTML error body (e.g. nginx 502 page) into a JSON detail message', async () => {
    const handler = (api.interceptors.response as any).handlers[0].rejected;
    const error = {
      config: {},
      response: { status: 502, headers: {}, data: '<html>502 Bad Gateway</html>' },
    };
    await expect(handler(error)).rejects.toMatchObject({
      response: { data: { detail: expect.stringContaining('Server error (502)') } },
    });
  });
});
```

- [ ] **Step 5: Run and fix until green**

```bash
cd frontend
npm test -- --coverage
```

Expected: all tests pass, coverage summary printed, `coverage/lcov.info` generated (matches `sonar.javascript.lcov.reportPaths` already set in `sonar-project.properties`). If the interceptor test's `handlers[0]` indexing doesn't match axios's actual internal structure at the installed version, inspect `api.interceptors.response` at runtime (`console.log`) and adjust the index/property access — axios does not officially guarantee this shape across versions, so pin down the real structure for whatever `axios` version is in `package.json` (`^1.7.2` at audit time) rather than trusting the snippet blindly.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/jest.config.js frontend/jest.setup.js frontend/src/lib/__tests__
git commit -m "test(frontend): add Jest + Testing Library tooling, cover auth store and api interceptors"
```

---

### Task 11: Wire real tests into CI (stop masking failures, add frontend coverage)

**Files:**
- Modify: `.github/workflows/cicd.yml`
- Modify: `sonar-project.properties`

**Interfaces:**
- Consumes: everything from Tasks 2–10 (backend `pytest`, frontend `npm test`).

Two problems in the current `test-backend` job need fixing now that there are real tests to run:

1. `python -m pytest --tb=short -q || python manage.py test --verbosity=2` — the `||` fallback means a **real pytest failure is silently swallowed** as long as `manage.py test` happens to pass (which it will, on the same tests, defeating the point). Drop the fallback entirely now that `pytest.ini` exists.
2. The manual `makemigrations && migrate` steps are redundant with `--nomigrations` in `pytest.ini` from Task 2 — remove them, since `--reuse-db --nomigrations` builds the schema straight from models.

- [ ] **Step 1: Rewrite the `test-backend` job's steps**

Replace the existing "Run tests" and "Run coverage" steps in `.github/workflows/cicd.yml` with:

```yaml
      - name: Run tests with coverage
        run: |
          cd backend
          mkdir -p data
          touch data/helpdesk.log
          export DATABASE_PATH=data/test.sqlite3
          export DJANGO_SETTINGS_MODULE=helpdesk.settings
          export SECRET_KEY=test-secret-key
          export CELERY_BROKER_URL=redis://localhost:6379/0
          export CELERY_TASK_ALWAYS_EAGER=True
          pytest --cov --cov-report=xml --cov-report=term-missing
```

This is a hard failure now if any backend test fails — no fallback, no `continue-on-error`.

- [ ] **Step 2: Add real test execution + coverage to `test-frontend`**

Insert a new step after "Install dependencies" and before "Lint check":

```yaml
      - name: Run tests with coverage
        run: |
          cd frontend
          npm test -- --coverage

      - name: Upload frontend coverage
        uses: actions/upload-artifact@v5
        if: always()
        with:
          name: frontend-coverage
          path: frontend/coverage/lcov.info
```

- [ ] **Step 3: Feed frontend coverage into the Sonar job**

In the `sonar-analysis` job, add a second coverage download next to the existing backend one:

```yaml
      - name: Download frontend coverage
        uses: actions/download-artifact@v5
        with:
          name: frontend-coverage
          path: frontend/coverage/
        continue-on-error: true
```

- [ ] **Step 4: Fix the placeholder Sonar org in `sonar-project.properties`**

The file currently has `sonar.organization=your-sonarcloud-org`, which is a placeholder — never filled in with the real SonarCloud org slug. The CI workflow itself overrides this at scan time via `-Dsonar.organization=${{ secrets.SONAR_ORGANIZATION }}`, so CI runs are unaffected, but this file is also what a developer's local `sonar-scanner` CLI run would use, and right now it silently points at a nonexistent org. Confirm the real org slug (`gh api user/orgs` or the SonarCloud dashboard URL — it's whatever `SONAR_ORGANIZATION` secret currently holds; you cannot read a secret's value via `gh secret list`, so get it from whoever set it up, or from the SonarCloud project settings page directly) and replace the placeholder:

```
sonar.organization=<real-org-slug>
```

- [ ] **Step 5: Push to the verification branch from Task 1 and confirm the whole pipeline runs cleanly through Sonar/Trivy**

```bash
git checkout ci/verify-lockfile-fix
git rebase main
git push -f origin ci/verify-lockfile-fix
gh pr checks --watch
```

Expected: `test-backend`, `test-frontend`, `sonar-analysis`, `trivy-source-scan` all pass. `build-and-push`/`deploy`/`health-check` only run on `push` to `main` per the workflow's `if:` conditions, so they won't fire on this PR branch — that's expected, not a bug.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/cicd.yml sonar-project.properties
git commit -m "ci: stop masking backend test failures, add frontend coverage, fix Sonar org placeholder"
```

---

### Task 12: Slack notification on pipeline triggers

**Files:**
- Modify: `.github/workflows/cicd.yml`

**Interfaces:**
- Produces: a Slack message posted to a configured channel whenever the pipeline finishes (success or failure), driven by an Incoming Webhook URL stored as the `SLACK_WEBHOOK_URL` repo secret.

⚠️ **Blocking prerequisite — needs a human, not an agent:** create a Slack Incoming Webhook (Slack workspace → App Directory → "Incoming Webhooks" → Add to Slack → pick the target channel → copy the `https://hooks.slack.com/services/...` URL), then:

```bash
gh secret set SLACK_WEBHOOK_URL --body "https://hooks.slack.com/services/XXX/YYY/ZZZ"
```

Do not attempt to generate or guess this URL — it must come from whoever owns the Slack workspace.

- [ ] **Step 1: Add a Slack step to the existing `notify` job**

The current `notify` job only sends email. Add Slack alongside it (not instead of — email stays as-is unless the team later decides to drop it) by inserting two new steps after the existing "Send failure email" step:

```yaml
      - name: Slack notify - success
        if: needs.health-check.result == 'success'
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":white_check_mark: *Helpdesk deployed* — <https://github.com/${{ github.repository }}/commit/${{ github.sha }}|${{ github.sha }}> on `${{ github.ref_name }}` by ${{ github.actor }}\nApp: http://${{ secrets.EC2_HOST }}:30080"
            }

      - name: Slack notify - failure
        if: needs.health-check.result == 'failure'
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": ":x: *Helpdesk deploy FAILED* — <https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}|run ${{ github.run_id }}> on `${{ github.ref_name }}` by ${{ github.actor }}"
            }
```

- [ ] **Step 2: Also notify on PR pipeline runs, not just `main` deploys**

Right now `health-check`/`notify` only ever run on a `push` to `main` (because `deploy` — everything downstream depends on it — is gated `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`). That means a PR's test/Sonar/Trivy failures currently notify nobody. Add a lightweight, always-runs job so PR-triggered failures also reach Slack:

```yaml
  notify-pr:
    name: "💬 Notify PR Pipeline Result"
    runs-on: ubuntu-latest
    needs: [test-backend, test-frontend, sonar-analysis, trivy-source-scan]
    if: always() && github.event_name == 'pull_request'
    steps:
      - name: Slack notify - PR pipeline result
        uses: slackapi/slack-github-action@v2.0.0
        with:
          webhook: ${{ secrets.SLACK_WEBHOOK_URL }}
          webhook-type: incoming-webhook
          payload: |
            {
              "text": "${{ contains(needs.*.result, 'failure') && ':x: PR checks failed' || ':white_check_mark: PR checks passed' }} — <${{ github.event.pull_request.html_url }}|#${{ github.event.pull_request.number }} ${{ github.event.pull_request.title }}> by ${{ github.actor }}"
            }
```

- [ ] **Step 3: Verify with a real PR**

Push a trivial change (e.g. a comment) to `ci/verify-lockfile-fix`, open/refresh the PR from Task 1, and confirm a Slack message lands in the configured channel once `test-backend`/`test-frontend`/`sonar-analysis`/`trivy-source-scan` finish.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/cicd.yml
git commit -m "ci: add Slack notifications for deploy and PR pipeline results"
```

---

### Task 13: Repo hygiene + close out the verification branch

**Files:**
- Delete: `$null`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:** none — cleanup only.

Two small things found during the audit that aren't blocking but are worth folding in while the CI file is already being touched:

- A stray `$null` file (59 bytes) is committed at repo root — almost certainly a Windows PowerShell redirect mistake (`... > $null` run from `cmd`/a shell where `$null` isn't special, creating a literal file). It has no purpose.
- The root `.gitignore` only excludes `.terraform/`. `frontend/node_modules/`, `backend/__pycache__/`, `backend/staticfiles/`, `backend/data/*.sqlite3`, `backend/media/`, and `.env` files aren't excluded — none happen to be tracked today, but there's nothing stopping a future `git add -A` from committing 150MB of `node_modules` or a real `.env` with secrets in it.
- `README.md` is a single line (`# helpdesk`) with no setup instructions — low priority, but worth at least a one-paragraph "how to run tests" pointer given this plan just added two test suites.

- [ ] **Step 1: Remove the stray file**

```bash
git rm '$null'
```

- [ ] **Step 2: Broaden `.gitignore`**

```
.terraform/

# Python
__pycache__/
*.pyc
backend/data/
backend/staticfiles/
backend/media/
*.sqlite3

# Node
node_modules/
frontend/.next/
frontend/coverage/

# Env
.env
.env.local
```

- [ ] **Step 3: Add a minimal test-running section to `README.md`**

Append:

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore README.md
git commit -m "chore: remove stray file, broaden .gitignore, document how to run tests"
```

- [ ] **Step 5: Merge the verification branch and confirm main goes green end-to-end**

```bash
gh pr merge ci/verify-lockfile-fix --squash
gh run watch
```

Expected: `test-backend`, `test-frontend`, `sonar-analysis`, `trivy-source-scan`, `build-and-push`, `deploy`, `health-check`, `notify`, `notify-pr` (n/a on a direct-to-main push, skipped by its `if:`) all report success on the `push` to `main`, and a Slack message lands in the configured channel confirming deploy success. This is the first time the full pipeline will have ever run end-to-end.

---

## Self-Review Notes

- **Spec coverage:** "fix the whole CI/CD pipeline" → Tasks 1, 9, 11, 13. "add tools for unit testing and code testing" → Tasks 2–10 (pytest-django + coverage + Jest/RTL, applied to every backend app and the frontend's core lib modules). "Slack integration for the triggers" → Task 12 (pipeline push/PR/deploy notifications via Incoming Webhook, distinct from the pre-existing ticket-creation Slack bot which was explicitly left alone per the Global Constraints).
- **Known gap intentionally left out of scope:** UI component tests for `src/app/**/page.tsx` pages (there are no extracted `src/components` files to unit-test yet — testing the pages themselves would mean React Testing Library + route mocking + Zustand store mocking per page, which is a meaningfully larger effort than this plan's "first real coverage" scope). Recommend a follow-up plan once this one lands, starting with `dashboard/tickets` and `login`/`register`, which carry the most business logic.
- **Known gap:** `slack_bot.py`/`slack_bridge.py`/`integrations/slack_views.py` (Socket Mode event handling for the ticket-creation bot) remain untested — covering them needs mocked Slack signing-secret verification and is a distinct, larger piece of work than the CI/CD-trigger notification this plan adds in Task 12.
- **Type/path consistency check:** confirmed against `backend/helpdesk/urls.py` directly — `path('api/auth/', include('accounts.urls'))`, `path('api/tickets/', include('tickets.urls'))`, `path('api/notifications/', include('notifications.urls'))`, `path('api/reports/', include('reports.urls'))`, and `reports/urls.py` → `path('dashboard/', DashboardStatsView.as_view())`. Every URL used in Tasks 3–7's test files matches these exactly; no corrections needed.
