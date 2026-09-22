#!/usr/bin/env bash
# Shared Slack notification helpers. Sourced by bootstrap.sh / deploy.sh / destroy.sh,
# not executed directly.
#
# Deliberately dependency-free beyond curl and the AWS CLI: no jq. Every AWS lookup
# below uses --query/--output text so this runs unchanged in Git Bash on Windows and on
# an ubuntu-latest GitHub runner.

# Hard rule: a notification must NEVER be able to fail a deploy or a teardown. Every
# function here warns and returns 0. Losing a Slack message is an annoyance; aborting
# a half-finished `terraform destroy` because a webhook 404'd leaves resources billing.

_slack_escape() {
  # Minimal JSON string escaping — backslash, double quote, newline. Terraform error
  # output routinely contains all three.
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN{ORS=""} {print sep $0; sep="\\n"}'
}

# credits_remaining — prints the account's remaining free-tier credit, e.g. "118.42".
# Prints "unknown" if the call fails for any reason (wrong partition, no permission,
# API not available in the region). Never fails the caller.
credits_remaining() {
  local v
  v=$(aws freetier get-account-plan-state \
    --region us-east-1 \
    --query 'accountPlanRemainingCredits.amount' \
    --output text 2>/dev/null) || v=""
  if [ -z "$v" ] || [ "$v" = "None" ]; then
    printf 'unknown'
  else
    printf '%s' "$v"
  fi
}

# slack_notify <color> <title> <body>
#   color: good | warning | danger  (or any hex like #36a64f)
slack_notify() {
  local color="$1" title="$2" body="$3"

  if [ -z "${TF_VAR_slack_webhook_url:-}" ]; then
    echo "  [slack] TF_VAR_slack_webhook_url is unset — skipping notification." >&2
    return 0
  fi

  local payload
  payload=$(cat <<EOF
{
  "attachments": [
    {
      "color": "${color}",
      "blocks": [
        {
          "type": "header",
          "text": { "type": "plain_text", "text": "$(_slack_escape "$title")", "emoji": true }
        },
        {
          "type": "section",
          "text": { "type": "mrkdwn", "text": "$(_slack_escape "$body")" }
        }
      ]
    }
  ]
}
EOF
)

  local http_code
  http_code=$(curl -s -o /dev/null -w '%{http_code}' \
    -X POST -H 'Content-type: application/json' \
    --data "$payload" \
    --max-time 15 \
    "$TF_VAR_slack_webhook_url" 2>/dev/null) || http_code="000"

  if [ "$http_code" != "200" ]; then
    echo "  [slack] webhook returned HTTP ${http_code} — message not delivered (continuing anyway)." >&2
  fi
  return 0
}

# slack_deploy_success <ip> <url> <grafana_url> <duration_seconds> <plan_summary>
slack_deploy_success() {
  local ip="$1" url="$2" grafana="$3" secs="$4" summary="$5"
  slack_notify "good" "✅ Helpdesk deployed to EKS" \
"*Site:* <${url}|${url}>
*Static IP:* \`${ip}\`
*Grafana:* <${grafana}|${grafana}>

*Terraform:* ${summary}
*Duration:* $((secs / 60))m $((secs % 60))s
*Credits remaining:* \$$(credits_remaining)

_Cluster is now billing at ~\$0.182/hr. Run \`infra/scripts/destroy.sh\` when you're done._"
}

# slack_deploy_failure <stage> <log_tail>
slack_deploy_failure() {
  local stage="$1" tail_text="$2"
  slack_notify "danger" "❌ Helpdesk deploy FAILED" \
"*Failed at:* ${stage}
*Credits remaining:* \$$(credits_remaining)

\`\`\`
${tail_text}
\`\`\`

_Partial resources may exist and may be billing. Check with \`infra/scripts/destroy.sh\`._"
}

# slack_destroy_result <status> <detail>
slack_destroy_result() {
  local status="$1" detail="$2"
  if [ "$status" = "ok" ]; then
    slack_notify "good" "🧹 Helpdesk EKS torn down" \
"${detail}

*Credits remaining:* \$$(credits_remaining)
_Billing for this cluster has stopped._"
  else
    slack_notify "danger" "⚠️ Helpdesk teardown INCOMPLETE" \
"${detail}

*Credits remaining:* \$$(credits_remaining)
*Resources may still be billing — this needs manual attention.*"
  fi
}
