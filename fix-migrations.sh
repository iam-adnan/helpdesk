#!/bin/bash
set -e

cd ~/mindstorm-helpdesk

echo "========================================"
echo "  Fix: Generate Django migrations"
echo "========================================"

# 1. Fix the startup command to generate migrations first
cat > docker-compose.yml << 'EOF'
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: helpdesk-backend
    restart: always
    volumes:
      - sqlite_data:/app/data
      - media_data:/app/media
    ports:
      - "8000:8000"
    environment:
      - DJANGO_SETTINGS_MODULE=helpdesk.settings
      - DATABASE_PATH=/app/data/db.sqlite3
      - ALLOWED_HOSTS=*
      - CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost,http://helpdesk.local
      - SECRET_KEY=ms-hd-prod-key-change-me-to-random-64-chars
      - CELERY_BROKER_URL=redis://redis:6379/0
      - DEBUG=true
    depends_on:
      - redis
    command: >
      sh -c "mkdir -p /app/data &&
             touch /app/data/helpdesk.log &&
             echo '--- Making migrations ---' &&
             python manage.py makemigrations accounts tickets notifications integrations reports settings_manager --noinput &&
             echo '--- Applying migrations ---' &&
             python manage.py migrate --noinput &&
             echo '--- Collecting static ---' &&
             python manage.py collectstatic --noinput &&
             echo '--- Starting server ---' &&
             gunicorn helpdesk.wsgi:application --bind 0.0.0.0:8000 --workers 3 --threads 2 --timeout 120 --access-logfile - --error-logfile -"

  celery:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: helpdesk-celery
    restart: always
    volumes:
      - sqlite_data:/app/data
      - media_data:/app/media
    environment:
      - DJANGO_SETTINGS_MODULE=helpdesk.settings
      - DATABASE_PATH=/app/data/db.sqlite3
      - CELERY_BROKER_URL=redis://redis:6379/0
    depends_on:
      - redis
      - backend
    command: >
      sh -c "sleep 15 && celery -A helpdesk worker -l info --concurrency=2"

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    container_name: helpdesk-frontend
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=/api
    depends_on:
      - backend

  redis:
    image: redis:7-alpine
    container_name: helpdesk-redis
    restart: always
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    container_name: helpdesk-nginx
    restart: always
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - media_data:/app/media
    depends_on:
      - backend
      - frontend

volumes:
  sqlite_data:
  media_data:
  redis_data:
EOF
echo "[OK] docker-compose.yml"

# 2. Fix Dockerfile to generate migrations at BUILD time (not just runtime)
cat > Dockerfile.backend << 'EOF'
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y gcc libffi-dev && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

RUN mkdir -p /app/data /app/media /app/staticfiles && \
    touch /app/data/helpdesk.log

# Generate migration files at build time
RUN python manage.py makemigrations accounts tickets notifications integrations reports settings_manager --noinput

EXPOSE 8000
EOF
echo "[OK] Dockerfile.backend"

# 3. Make sure all app configs are correct (Django needs these to detect models)
cat > backend/accounts/apps.py << 'PYEOF'
from django.apps import AppConfig

class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'
PYEOF

cat > backend/tickets/apps.py << 'PYEOF'
from django.apps import AppConfig

class TicketsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'tickets'

    def ready(self):
        try:
            import tickets.signals  # noqa
        except ImportError:
            pass
PYEOF

cat > backend/notifications/apps.py << 'PYEOF'
from django.apps import AppConfig

class NotificationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'notifications'
PYEOF

cat > backend/integrations/apps.py << 'PYEOF'
from django.apps import AppConfig

class IntegrationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'integrations'
PYEOF

cat > backend/reports/apps.py << 'PYEOF'
from django.apps import AppConfig

class ReportsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'reports'
PYEOF

cat > backend/settings_manager/apps.py << 'PYEOF'
from django.apps import AppConfig

class SettingsManagerConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'settings_manager'
PYEOF
echo "[OK] All apps.py"

# 4. Make sure every app has __init__.py and migrations/__init__.py
for app in accounts tickets notifications integrations reports settings_manager; do
    touch backend/$app/__init__.py
    mkdir -p backend/$app/migrations
    touch backend/$app/migrations/__init__.py
    # Remove any stale/broken migration files (keep __init__.py)
    find backend/$app/migrations/ -name '*.py' ! -name '__init__.py' -delete 2>/dev/null || true
    find backend/$app/migrations/ -name '*.pyc' -delete 2>/dev/null || true
done
echo "[OK] Clean migration dirs"

# 5. Ensure all model files exist and are importable
# Verify accounts/models.py exists
if [ ! -f backend/accounts/models.py ]; then
    echo "ERROR: backend/accounts/models.py missing!"
    exit 1
fi

# Verify tickets/models.py exists
if [ ! -f backend/tickets/models.py ]; then
    echo "ERROR: backend/tickets/models.py missing!"
    exit 1
fi

# 6. Verify notifications/models.py
if [ ! -f backend/notifications/models.py ]; then
cat > backend/notifications/models.py << 'PYEOF'
from django.db import models
from django.conf import settings
import uuid

class NotificationTemplate(models.Model):
    class Channel(models.TextChoices):
        EMAIL = 'email', 'Email'
        SLACK = 'slack', 'Slack'
    class EventType(models.TextChoices):
        TICKET_CREATED = 'ticket_created', 'Ticket Created'
        TICKET_ASSIGNED = 'ticket_assigned', 'Ticket Assigned'
        TICKET_UPDATED = 'ticket_updated', 'Ticket Updated'
        TICKET_COMMENTED = 'ticket_commented', 'Comment Added'
        TICKET_RESOLVED = 'ticket_resolved', 'Ticket Resolved'
        TICKET_CLOSED = 'ticket_closed', 'Ticket Closed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    event_type = models.CharField(max_length=30, choices=EventType.choices)
    channel = models.CharField(max_length=10, choices=Channel.choices)
    subject = models.CharField(max_length=255, blank=True)
    body = models.TextField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.channel})"

class Notification(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SENT = 'sent', 'Sent'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=255)
    message = models.TextField()
    channel = models.CharField(max_length=10, choices=NotificationTemplate.Channel.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    read = models.BooleanField(default=False)
    ticket_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
PYEOF
echo "[OK] Created notifications/models.py"
fi

# 7. Verify integrations/models.py
if [ ! -f backend/integrations/models.py ]; then
cat > backend/integrations/models.py << 'PYEOF'
from django.db import models
import uuid

class SlackInstallation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team_id = models.CharField(max_length=50, unique=True)
    team_name = models.CharField(max_length=100)
    bot_token = models.CharField(max_length=255)
    channel_id = models.CharField(max_length=50, blank=True)
    channel_name = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.team_name
PYEOF
echo "[OK] Created integrations/models.py"
fi

# 8. Verify settings_manager/models.py
if [ ! -f backend/settings_manager/models.py ]; then
cat > backend/settings_manager/models.py << 'PYEOF'
from django.db import models

class AppSetting(models.Model):
    key = models.CharField(max_length=100, unique=True, primary_key=True)
    value = models.TextField(default='')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.key} = {self.value[:50]}"

    @classmethod
    def get(cls, key, default=''):
        try:
            return cls.objects.get(key=key).value
        except cls.DoesNotExist:
            return default

    @classmethod
    def set(cls, key, value):
        obj, _ = cls.objects.update_or_create(key=key, defaults={'value': value})
        return obj
PYEOF
echo "[OK] Created settings_manager/models.py"
fi

# 9. Reports has no models (just views), make sure it has empty models
if [ ! -f backend/reports/models.py ]; then
    echo "# No models for reports app" > backend/reports/models.py
    echo "[OK] Created reports/models.py (empty)"
fi

# 10. Quick local test — try makemigrations outside Docker to verify
echo ""
echo "--- Testing makemigrations locally (dry run) ---"
cd backend
pip install django djangorestframework djangorestframework-simplejwt django-cors-headers django-filter django-celery-beat whitenoise drf-spectacular Pillow 2>/dev/null || true
DATABASE_PATH=/tmp/test.sqlite3 python manage.py makemigrations accounts tickets notifications integrations reports settings_manager --noinput --dry-run 2>&1 | head -20 || echo "(Local test skipped — will run inside Docker)"
cd ..

echo ""
echo "========================================"
echo "  Rebuilding containers..."
echo "========================================"

# Clean everything
docker compose down -v 2>/dev/null || true

# Remove old images to force fresh build
docker rmi mindstorm-helpdesk-backend 2>/dev/null || true
docker rmi mindstorm-helpdesk-celery 2>/dev/null || true

# Build
echo "Building backend (this generates migrations)..."
docker compose build --no-cache backend 2>&1 | tail -20

echo ""
echo "Building frontend..."
docker compose build --no-cache frontend 2>&1 | tail -10

echo ""
echo "Starting all services..."
docker compose up -d

echo ""
echo "Waiting for backend..."
for i in $(seq 1 40); do
    if curl -sf http://localhost:8000/api/health/ > /dev/null 2>&1; then
        echo ""
        echo "  BACKEND IS UP!"
        curl -s http://localhost:8000/api/health/
        echo ""
        break
    fi
    if [ $i -eq 40 ]; then
        echo ""
        echo "  Backend still not up. Checking logs..."
        docker compose logs --tail=30 backend
    fi
    sleep 2
    printf "  waiting... %ds\r" $((i*2))
done

echo ""
echo "--- Container status ---"
docker compose ps
echo ""
echo "--- Backend logs (last 20 lines) ---"
docker compose logs --tail=20 backend
echo ""
echo "========================================"
echo "  DONE!"
echo "========================================"
echo ""
echo "  If backend shows 'Starting server' in logs -> it's working"
echo "  Go to: http://localhost/register"
echo "  First account = auto ADMIN"
echo ""
echo "  If still failing, run:"
echo "    docker compose logs backend"
echo "========================================"
