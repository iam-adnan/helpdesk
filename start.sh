#!/bin/bash
echo "======================================"
echo "  Mindstorm Helpdesk - Starting..."
echo "======================================"

# Build and start
docker compose build --no-cache
docker compose up -d

echo ""
echo "Waiting for services to start..."
sleep 10

# Check status
docker compose ps

echo ""
echo "======================================"
echo "  DEPLOYMENT COMPLETE!"
echo "======================================"
echo ""
echo "  App:   http://localhost"
echo "  API:   http://localhost:8000/api/"
echo ""
echo "  FIRST STEP:"
echo "  1. Go to http://localhost/register"
echo "  2. Create your first account with @mindstormstudios.com email"
echo "  3. This first account automatically becomes ADMIN"
echo ""
echo "  ADMIN PANEL:"
echo "  - Users: http://localhost/dashboard/admin/users"
echo "  - Settings: http://localhost/dashboard/admin/settings"
echo "  - AI Setup: http://localhost/dashboard/admin/ai-setup"
echo "  - Slack: http://localhost/dashboard/admin/integrations"
echo "  - Reports: http://localhost/dashboard/admin/reports"
echo ""
echo "  SLACK SETUP:"
echo "  Slash command URL: http://YOUR_DOMAIN/slack/commands/"
echo "  Interactivity URL: http://YOUR_DOMAIN/slack/interactions/"
echo ""
echo "  LOGS: docker compose logs -f"
echo "  STOP: docker compose down"
echo "======================================"
