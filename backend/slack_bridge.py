"""
Standalone Flask app that handles Slack slash commands and interactions.
Runs on port 9000. No Django, no CSRF, no middleware — just raw HTTP.
Talks to the Django backend via internal API calls.
"""

from flask import Flask, request, jsonify
import requests
import json
import os
import sqlite3
import logging
import secrets

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('slack_bridge')

DB_PATH = os.environ.get('DATABASE_PATH', '/app/data/db.sqlite3')


def get_setting(key, default=''):
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT value FROM settings_manager_appsetting WHERE key=?", (key,))
        row = cur.fetchone()
        conn.close()
        return row[0] if row else default
    except Exception as e:
        log.error(f"DB read error for {key}: {e}")
        return default


@app.route('/slack/commands/', methods=['POST'])
def slack_command():
    log.info("=== SLACK COMMAND RECEIVED ===")
    log.info(f"Form data: {dict(request.form)}")

    trigger_id = request.form.get('trigger_id', '')
    user_id = request.form.get('user_id', '')
    user_name = request.form.get('user_name', '')

    log.info(f"User: {user_name}, trigger_id: {trigger_id}")

    bot_token = get_setting('slack_bot_token', '')
    if not bot_token:
        log.error("No bot token configured")
        return jsonify({
            'response_type': 'ephemeral',
            'text': ':warning: Helpdesk Slack bot token not configured. Ask admin to set it up.'
        })

    if not trigger_id:
        return jsonify({
            'response_type': 'ephemeral',
            'text': 'Could not open form. Please try again.'
        })

    try:
        from slack_sdk import WebClient
        client = WebClient(token=bot_token)

        result = client.views_open(
            trigger_id=trigger_id,
            view={
                "type": "modal",
                "callback_id": "create_ticket",
                "title": {"type": "plain_text", "text": "Raise a Ticket"},
                "submit": {"type": "plain_text", "text": "Submit Ticket"},
                "close": {"type": "plain_text", "text": "Cancel"},
                "blocks": [
                    {
                        "type": "input", "block_id": "subject_block",
                        "element": {
                            "type": "plain_text_input",
                            "action_id": "subject_input",
                            "placeholder": {"type": "plain_text", "text": "Brief summary of your issue"}
                        },
                        "label": {"type": "plain_text", "text": "Subject"}
                    },
                    {
                        "type": "input", "block_id": "description_block",
                        "element": {
                            "type": "plain_text_input",
                            "action_id": "desc_input",
                            "multiline": True,
                            "placeholder": {"type": "plain_text", "text": "Describe your issue"}
                        },
                        "label": {"type": "plain_text", "text": "Description"},
                        "optional": True
                    },
                    {
                        "type": "input", "block_id": "category_block",
                        "element": {
                            "type": "static_select",
                            "action_id": "cat_select",
                            "placeholder": {"type": "plain_text", "text": "Select"},
                            "options": [
                                {"text": {"type": "plain_text", "text": "Problem"}, "value": "problem"},
                                {"text": {"type": "plain_text", "text": "Request"}, "value": "request"},
                                {"text": {"type": "plain_text", "text": "Question"}, "value": "question"},
                                {"text": {"type": "plain_text", "text": "Incident"}, "value": "incident"},
                                {"text": {"type": "plain_text", "text": "Bug Report"}, "value": "bug"},
                            ]
                        },
                        "label": {"type": "plain_text", "text": "Category"}
                    },
                    {
                        "type": "input", "block_id": "priority_block",
                        "element": {
                            "type": "static_select",
                            "action_id": "pri_select",
                            "initial_option": {"text": {"type": "plain_text", "text": "Medium"}, "value": "medium"},
                            "options": [
                                {"text": {"type": "plain_text", "text": "Low"}, "value": "low"},
                                {"text": {"type": "plain_text", "text": "Medium"}, "value": "medium"},
                                {"text": {"type": "plain_text", "text": "High"}, "value": "high"},
                                {"text": {"type": "plain_text", "text": "Urgent"}, "value": "urgent"},
                            ]
                        },
                        "label": {"type": "plain_text", "text": "Priority"}
                    },
                ]
            }
        )
        log.info(f"Modal opened: {result.get('ok')}")

    except Exception as e:
        log.error(f"Slack API error: {e}", exc_info=True)
        return jsonify({
            'response_type': 'ephemeral',
            'text': f':x: Error: {str(e)}'
        })

    return jsonify({})


@app.route('/slack/interactions/', methods=['POST'])
def slack_interaction():
    log.info("=== SLACK INTERACTION RECEIVED ===")

    try:
        payload = json.loads(request.form.get('payload', '{}'))
    except Exception as e:
        log.error(f"Bad payload: {e}")
        return jsonify({})

    if payload.get('type') != 'view_submission':
        return jsonify({})

    if payload.get('view', {}).get('callback_id') != 'create_ticket':
        return jsonify({})

    try:
        values = payload['view']['state']['values']
        slack_user_id = payload['user']['id']
        slack_username = payload['user'].get('username', '')

        subject = values['subject_block']['subject_input']['value']
        description = values['description_block']['desc_input'].get('value') or ''
        category = values['category_block']['cat_select']['selected_option']['value']
        priority = values['priority_block']['pri_select']['selected_option']['value']

        log.info(f"Ticket: '{subject}' by {slack_username} ({slack_user_id})")

        # Get user email from Slack
        bot_token = get_setting('slack_bot_token', '')
        email = f"{slack_username}@mindstormstudios.com"

        if bot_token:
            try:
                from slack_sdk import WebClient
                info = WebClient(token=bot_token).users_info(user=slack_user_id)
                profile_email = info['user'].get('profile', {}).get('email', '')
                if profile_email:
                    email = profile_email
                    log.info(f"Got email from Slack profile: {email}")
            except Exception as e:
                log.warning(f"Could not get Slack email: {e}")

        # Create user + ticket directly in SQLite
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()

        # Find or create user
        cur.execute("SELECT id FROM accounts_user WHERE email=?", (email.lower(),))
        row = cur.fetchone()

        if row:
            user_id_db = row[0]
            log.info(f"Existing user: {email}")
        else:
            import uuid
            from datetime import datetime
            user_id_db = str(uuid.uuid4())
            username = email.split('@')[0]
            now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

            # Check if username exists
            cur.execute("SELECT id FROM accounts_user WHERE username=?", (username,))
            if cur.fetchone():
                username = f"{username}_{slack_user_id[:4]}"

            cur.execute("""
                INSERT INTO accounts_user
                (id, password, last_login, is_superuser, username, first_name, last_name,
                 is_staff, is_active, date_joined, email, role, department, phone,
                 slack_user_id, created_at, updated_at)
                VALUES (?, ?, NULL, 0, ?, ?, '', 0, 1, ?, ?, 'user', '', '', ?, ?, ?)
            """, (
                user_id_db,
                'pbkdf2_sha256$720000$unused$unused=',  # unusable password
                username,
                username.replace('.', ' ').title(),
                now, email.lower(), slack_user_id, now, now
            ))
            conn.commit()
            log.info(f"Created user: {email}")

        # Generate ticket number
        cur.execute("SELECT ticket_number FROM tickets_ticket ORDER BY created_at DESC LIMIT 1")
        last = cur.fetchone()
        if last and last[0]:
            try:
                num = int(last[0].replace('MS-', '')) + 1
            except ValueError:
                num = 1
        else:
            num = 1
        ticket_number = f"MS-{num:05d}"

        # Create ticket
        import uuid
        from datetime import datetime
        ticket_id = str(uuid.uuid4())
        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')

        cur.execute("""
            INSERT INTO tickets_ticket
            (id, ticket_number, subject, description, status, priority, category,
             support_team, created_by_id, assigned_to_id, slack_channel_id,
             slack_message_ts, first_response_at, resolved_at, closed_at,
             created_at, updated_at, tags)
            VALUES (?, ?, ?, ?, 'open', ?, ?, 'IT', ?, NULL, '', '', NULL, NULL, NULL, ?, ?, '[]')
        """, (
            ticket_id, ticket_number, subject, description,
            priority, category, user_id_db, now, now
        ))
        conn.commit()
        log.info(f"Ticket created: {ticket_number}")

        # Post to Slack channel
        channel_id = get_setting('slack_channel_id', '')
        if bot_token and channel_id:
            try:
                from slack_sdk import WebClient
                client = WebClient(token=bot_token)
                result = client.chat_postMessage(
                    channel=channel_id,
                    text=(
                        f":ticket: *New Ticket: {ticket_number}*\n"
                        f"*Subject:* {subject}\n"
                        f"*Category:* {category} | *Priority:* {priority}\n"
                        f"*Created by:* <@{slack_user_id}>"
                    ),
                )
                # Save slack message reference
                cur.execute(
                    "UPDATE tickets_ticket SET slack_channel_id=?, slack_message_ts=? WHERE id=?",
                    (channel_id, result['ts'], ticket_id)
                )
                conn.commit()
                log.info(f"Posted to Slack channel {channel_id}")
            except Exception as e:
                log.error(f"Slack post error: {e}")

        conn.close()

    except Exception as e:
        log.error(f"Interaction error: {e}", exc_info=True)

    return jsonify({})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'slack-bridge'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8443)
