#!/bin/bash

echo "============================================"
echo " Mindstorm IT Helpdesk - Starting up"
echo "============================================"

echo "[1/5] Running database migrations..."
python manage.py migrate --noinput
if [ $? -ne 0 ]; then
    echo "ERROR: migrations failed"
    exit 1
fi
echo "  Migrations complete."

echo "[2/5] Collecting static files..."
python manage.py collectstatic --noinput 2>&1 | tail -2
echo "  Static files done."

echo "[3/5] Seeding SLA policies..."
python manage.py shell << 'PYEOF'
from helpdesk.models import SLAPolicy
defaults = [
    {'name': 'Critical', 'priority': 'critical', 'response_hours': 1,  'resolve_hours': 4},
    {'name': 'High',     'priority': 'high',     'response_hours': 4,  'resolve_hours': 24},
    {'name': 'Medium',   'priority': 'medium',   'response_hours': 8,  'resolve_hours': 72},
    {'name': 'Low',      'priority': 'low',      'response_hours': 24, 'resolve_hours': 168},
]
for d in defaults:
    obj, created = SLAPolicy.objects.get_or_create(priority=d['priority'], defaults=d)
    print(f"  {'Created' if created else 'Exists'}: {d['name']} SLA")
PYEOF

echo "[4/5] Creating admin user..."
python manage.py shell << 'PYEOF'
import os
from helpdesk.models import User

email    = os.environ.get('ADMIN_EMAIL', 'adnan.akram@mindstormstudios.com')
password = os.environ.get('ADMIN_PASSWORD', 'Adnan@Helpdesk2026!')
parts    = email.split('@')[0].split('.')
username = email.split('@')[0].replace('.', '_')

try:
    user = User.objects.get(email=email)
    user.set_password(password)
    user.role = 'admin'
    user.is_staff = True
    user.is_superuser = True
    user.save()
    print(f"  Admin updated: {email}")
except User.DoesNotExist:
    User.objects.create_superuser(
        username=username,
        email=email,
        password=password,
        first_name=parts[0].capitalize() if parts else 'Admin',
        last_name=parts[1].capitalize() if len(parts) > 1 else '',
        role='admin',
    )
    print(f"  Admin created: {email}")
    print(f"  Password: {password}")
PYEOF

echo "[5/5] Starting Gunicorn..."
echo "  URL: ${FRONTEND_URL}"
exec gunicorn config.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 3 \
    --worker-class sync \
    --timeout 120 \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
