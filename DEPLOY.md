# Mindstorm IT Helpdesk — Docker Deployment Guide

## What You Get
- Full IT ticketing system at http://YOUR_SERVER_IP
- Login restricted to @mindstormstudios.com Google accounts
- Admin account pre-created: adnan.akram@mindstormstudios.com / Adnan@Helpdesk2026!
- Slack integration, SLA timers, auto-assignment, canned replies, attachments
- Auto-restarts on server reboot

## Architecture
```
Browser → Nginx (port 80) → Django backend (port 8000 internal)
                          → React frontend (served as static files)
```

---

## Step 1 — Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version          # should show 24+
docker compose version    # should show 2.x
```

---

## Step 2 — Create .env file

```bash
# Go to your repo directory
cd /home/it/it-helpdesk    # adjust to your actual path

# Create config file
cp .env.example .env
nano .env
```

**Fill in these values — everything else can stay as default:**

```env
DJANGO_SECRET_KEY=<run: python3 -c "import secrets; print(secrets.token_hex(50))">
ALLOWED_HOSTS=localhost,127.0.0.1,YOUR_SERVER_IP
FRONTEND_URL=http://YOUR_SERVER_IP
CORS_ALLOWED_ORIGINS=http://YOUR_SERVER_IP
CSRF_TRUSTED_ORIGINS=http://YOUR_SERVER_IP
GOOGLE_CLIENT_ID=      ← from Step 3
GOOGLE_CLIENT_SECRET=  ← from Step 3
```

Save: **Ctrl+O → Enter → Ctrl+X**

---

## Step 3 — Google OAuth (free, 5 minutes)

1. Go to **https://console.cloud.google.com**
2. Click the project dropdown (top left) → **New Project** → name: `Mindstorm Helpdesk` → Create
3. Left menu → **APIs & Services → OAuth consent screen**
   - User Type: **Internal** → click Create
   - App name: `Mindstorm Helpdesk`
   - Support email: pick your email
   - Click **Save and Continue** through all 4 steps
4. Left menu → **APIs & Services → Credentials**
   - Click **+ Create Credentials** → **OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: `Mindstorm Helpdesk`
   - Under **Authorized redirect URIs** → **+ Add URI**:
     ```
     http://YOUR_SERVER_IP/accounts/google/login/callback/
     ```
   - Click **Create**
5. A popup shows your **Client ID** and **Client Secret** — copy both into `.env`
6. Save `.env` again

> **Important:** The redirect URI must match EXACTLY — correct IP, no trailing slash issues, must include `/accounts/google/login/callback/`

---

## Step 4 — Open Firewall Port

```bash
sudo ufw allow 80/tcp
sudo ufw allow 22/tcp    # keep SSH open!
sudo ufw enable
sudo ufw status
```

---

## Step 5 — Deploy!

```bash
docker compose up -d --build
```

**First build takes 3-5 minutes** (downloads Node 18, Python 3.11, builds React, installs packages).

Watch the startup:
```bash
docker compose logs -f backend
```

You'll see this when ready:
```
[1/6] Running database migrations... ✓
[2/6] Collecting static files... ✓
[3/6] Configuring Google OAuth site... ✓
[4/6] Seeding default SLA policies... ✓
[5/6] Creating admin user...
      Admin created: adnan.akram@mindstormstudios.com / Adnan@Helpdesk2026!
[6/6] Starting Gunicorn... ✓
```

Open browser: **http://YOUR_SERVER_IP** 🎉

---

## First Login

Two ways to log in:

**Option A — Google login:**
- Click "Continue with Google"
- Sign in with any @mindstormstudios.com account
- First user auto-becomes admin

**Option B — Direct admin:**
- Go to http://YOUR_SERVER_IP/django-admin/
- Email: `adnan.akram@mindstormstudios.com`
- Password: `Adnan@Helpdesk2026!`

---

## Useful Commands

```bash
# Check all containers are running
docker compose ps

# Live backend logs
docker compose logs -f backend

# Live all logs
docker compose logs -f

# Restart everything
docker compose restart

# Stop everything
docker compose down

# Rebuild after code changes
docker compose up -d --build

# Run a Django management command
docker compose exec backend python manage.py shell

# Manually create another admin
docker compose exec backend python manage.py shell -c "
from helpdesk.models import User
u = User.objects.create_superuser(
    username='newadmin',
    email='user@mindstormstudios.com',
    password='SecurePassword123!',
    role='admin'
)
print('Created:', u.email)
"

# Backup database
cp ./backend/data/helpdesk.db ./helpdesk-backup-$(date +%Y%m%d-%H%M).db
```

---

## Update the App

```bash
git pull
docker compose up -d --build
# Migrations run automatically on startup
```

---

## Slack Setup (Optional — add later)

After the site is running, set up the Slack bot:

1. Go to https://api.slack.com/apps → Create New App → From scratch
2. Name: `Mindstorm Helpdesk`, Workspace: Mindstorm Studios
3. **OAuth & Permissions** → Bot Token Scopes, add:
   `chat:write`, `chat:write.public`, `im:write`, `users:read`, `users:read.email`, `commands`
4. **Install to Workspace** → copy Bot OAuth Token (`xoxb-...`)
5. **Slash Commands** → Create `/helpdesk`
   - Request URL: `http://YOUR_SERVER_IP/slack/command/`
6. **Event Subscriptions** → Enable
   - Request URL: `http://YOUR_SERVER_IP/slack/events/`
   - Subscribe to: `message.channels`
7. Add to your `.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-your-token
   SLACK_SIGNING_SECRET=your-secret
   SLACK_IT_CHANNEL=#it-helpdesk
   ```
8. Restart: `docker compose restart backend`
9. Invite bot to your channel: `/invite @Mindstorm Helpdesk`

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't reach site | `sudo ufw allow 80` then `docker compose ps` |
| Backend not starting | `docker compose logs backend --tail 50` |
| "redirect_uri_mismatch" | Google Console redirect URI must be exactly `http://YOUR_IP/accounts/google/login/callback/` |
| Unauthorized error on login | User is using non-@mindstormstudios.com account — correct behavior |
| 500 on all pages | Check `.env` has DJANGO_SECRET_KEY set |
| Permission denied on docker | `sudo usermod -aG docker $USER` then log out and back in |
| Port 80 already in use | `sudo lsof -i :80` and stop whatever is using it |
| Google OAuth not working after deploy | Make sure you restarted backend after adding credentials to .env |

---

*Mindstorm Studios IT Helpdesk v2.0 — Docker Edition*
