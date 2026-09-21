# Slack app setup

`manifest.json` in this directory declares everything the codebase's Slack integrations
actually use — confirmed by reading every `slack_sdk`/`slack_bolt` call across
`backend/slack_bot.py`, `backend/integrations/slack_views.py`, and
`backend/integrations/tasks.py`.

## Two separate Slack integrations in this codebase — don't conflate their credentials

| | Ticket-creation bot (`slack_bot.py`) | CI/CD + Alertmanager notifications |
|---|---|---|
| Mechanism | Slack Bot Token + App-Level Token, Socket Mode | Incoming Webhook URL |
| Where the credential lives | **Django admin panel** (`AppSetting` DB rows: `slack_bot_token`, `slack_app_token`) — read at runtime via `AppSetting.get(...)`, not an environment variable | GitHub secret `SLACK_WEBHOOK_URL` + Terraform var `TF_VAR_slack_webhook_url` (this session's work) |
| What it needs from this manifest | Bot scopes (`chat:write`, `chat:write.public`, `users:read`, `commands`), Socket Mode, the `/helpdesk` slash command | The `incoming-webhook` scope + the "Incoming Webhooks" feature |

Don't try to put the bot token (`xoxb-...`) or app-level token (`xapp-...`) into a GitHub
secret or `terraform.tfvars` — neither is read from there. They're entered into the
running app's own settings UI after deploy (`settings_manager` app).

## Steps

1. **Create the app from the manifest** — on [api.slack.com/apps](https://api.slack.com/apps), "Create New App" → "From an app manifest" → pick the `Helpdesk-test` workspace → paste `manifest.json`. (If your Slack CLI version supports manifest-based creation directly, `slack manifest validate manifest.json` then follow its create flow — the underlying schema is the same either way, see [api.slack.com/reference/manifests](https://api.slack.com/reference/manifests).)

2. **Install the app to the workspace** — "Install App" in the left nav. This generates the **Bot Token** (`xoxb-...`). Copy it — it goes into the app's admin settings panel (`slack_bot_token`) after the app is deployed, not anywhere in this repo.

3. **Generate an App-Level Token** — "Basic Information" → "App-Level Tokens" → "Generate Token and Scopes" → add scope `connections:write` → generate. This is the **App Token** (`xapp-...`), needed for Socket Mode. Also goes into the admin settings panel (`slack_app_token`), not this repo.

4. **Add an Incoming Webhook** — "Incoming Webhooks" → toggle on → "Add New Webhook to Workspace" → pick the channel it should post to (this is a one-time choice; the channel can't be overridden per-message afterward — see the comment in `infra/terraform/monitoring.tf`'s Alertmanager config for why). This URL is what goes into:
   - `gh secret set SLACK_WEBHOOK_URL --body "https://hooks.slack.com/services/..."`
   - `export TF_VAR_slack_webhook_url="https://hooks.slack.com/services/..."` (same URL — both CI deploy notifications and Alertmanager runtime alerts post to this one channel/webhook by design, see the plan doc's Task 16)

   If you'd rather split deploy noise from real alerts into two channels, repeat this step once more for a second channel and use that second URL only for `TF_VAR_slack_webhook_url` (Alertmanager) while `SLACK_WEBHOOK_URL` (CI) keeps the first — nothing else in the code needs to change for that, they're independent values.

5. **Invite the bot to whichever channel(s) people will run `/helpdesk` from** — `chat:write.public` (already in the manifest's scopes) lets it post to any public channel without an explicit `/invite`, but the slash command itself still needs to be run from within a channel the bot can see.

## Heads-up: two other things in the codebase reference Slack and don't currently work

Found while tracing this, not something this session touched or was asked to fix:

- `backend/slack_bridge.py` (a standalone Flask app) and `backend/integrations/slack_views.py`
  (Django views at `/slack/commands/`, `/slack/interactions/`) both implement an
  HTTP-based alternative to `slack_bot.py`'s Socket Mode — but neither is wired into
  `docker-compose.yml` or any `k8s/` manifest as an actual running service.
  `nginx.conf` proxies `/slack/` to an upstream `slack-bridge:9000` that doesn't exist
  as a service anywhere (local dev via `docker-compose` or the old k3s deploy). Looks
  like leftover code from an earlier architecture iteration, superseded by
  `slack_bot.py`'s Socket Mode (which needs no inbound webhook/Request URL at all —
  it opens an outbound connection to Slack). This manifest is built around Socket
  Mode since that's the path actually deployed.
