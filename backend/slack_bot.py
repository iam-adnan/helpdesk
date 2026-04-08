"""
Slack Bot using Socket Mode — v3
Uses Django ORM instead of raw SQL to create tickets.
"""

import os
import sys
import logging
import django

# Setup Django BEFORE importing any models
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'helpdesk.settings')
sys.path.insert(0, '/app')
django.setup()

from datetime import datetime
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from settings_manager.models import AppSetting
from accounts.models import User
from tickets.models import Ticket, TicketActivity
import secrets

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('slack_bot')

PRIORITY_EMOJI = {'low': ':large_green_circle:', 'medium': ':large_yellow_circle:', 'high': ':large_orange_circle:', 'urgent': ':red_circle:'}
CATEGORY_EMOJI = {'problem': ':wrench:', 'request': ':inbox_tray:', 'question': ':question:', 'incident': ':rotating_light:', 'bug': ':bug:', 'change': ':arrows_counterclockwise:'}
SLA_HOURS = {'low': 48, 'medium': 24, 'high': 8, 'urgent': 2}
PORTAL_URL = os.environ.get('PORTAL_URL', 'https://192.168.50.25')


def wait_for_settings():
    import time
    while True:
        bot = AppSetting.get('slack_bot_token', '')
        app_tok = AppSetting.get('slack_app_token', '')
        if bot and app_tok:
            return bot, app_tok
        log.info("Waiting for Slack tokens in admin panel...")
        time.sleep(15)


def find_or_create_user(email, slack_user_id, display_name):
    """Use Django ORM to find or create user."""
    try:
        user = User.objects.get(email=email.lower())
        if not user.slack_user_id:
            user.slack_user_id = slack_user_id
            user.save(update_fields=['slack_user_id'])
        return user
    except User.DoesNotExist:
        username = email.split('@')[0]
        # Ensure unique username
        base = username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base}{counter}"
            counter += 1

        user = User(
            email=email.lower(),
            username=username,
            first_name=display_name or base.replace('.', ' ').title(),
            slack_user_id=slack_user_id,
            role='user',
        )
        user.set_password(secrets.token_urlsafe(16))
        user.save()
        log.info(f"Created user via ORM: {email}")
        return user


def create_ticket_orm(subject, description, category, priority, user):
    """Use Django ORM to create ticket — consistent with portal tickets."""
    ticket = Ticket(
        subject=subject,
        description=description,
        category=category,
        priority=priority,
        created_by=user,
        support_team='IT',
    )
    ticket.save()  # This triggers the ticket_number generation in model.save()

    TicketActivity.objects.create(
        ticket=ticket,
        user=user,
        action='created',
        new_value=f'{ticket.ticket_number} (via Slack)'
    )

    log.info(f"Ticket created via ORM: {ticket.ticket_number} (id={ticket.id})")
    return ticket


def build_user_notification(ticket, category, priority):
    cat_emoji = CATEGORY_EMOJI.get(category, ':ticket:')
    pri_emoji = PRIORITY_EMOJI.get(priority, ':white_circle:')
    return [
        {"type": "section", "text": {"type": "mrkdwn", "text": ":white_check_mark: *Your IT ticket has been received!*"}},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Ticket:*\n`{ticket.ticket_number}`"},
            {"type": "mrkdwn", "text": f"*Subject:*\n{ticket.subject}"},
            {"type": "mrkdwn", "text": f"*Priority:*\n{pri_emoji} {priority.title()}"},
            {"type": "mrkdwn", "text": f"*Category:*\n{cat_emoji} {category.title()}"},
        ]},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": ":clock1: Our IT team will get back to you shortly."}]},
        {"type": "actions", "elements": [
            {"type": "button", "text": {"type": "plain_text", "text": ":globe_with_meridians: View on Portal", "emoji": True},
             "url": f"{PORTAL_URL}/dashboard/tickets/{ticket.id}", "action_id": "view_portal"}
        ]}
    ]


def build_team_notification(ticket, category, priority, slack_user_id, user_name):
    cat_emoji = CATEGORY_EMOJI.get(category, ':ticket:')
    pri_emoji = PRIORITY_EMOJI.get(priority, ':white_circle:')
    sla_hours = SLA_HOURS.get(priority, 24)
    desc = (ticket.description[:150] + '...') if len(ticket.description) > 150 else ticket.description
    if not desc:
        desc = '_No description provided_'

    return [
        {"type": "header", "text": {"type": "plain_text", "text": f":ticket: New Ticket: {ticket.ticket_number}", "emoji": True}},
        {"type": "section", "text": {"type": "mrkdwn", "text": f"*{ticket.subject}*\n{desc}"}},
        {"type": "divider"},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Status:*\n:new: Open"},
            {"type": "mrkdwn", "text": f"*Priority:*\n{pri_emoji} {priority.title()}"},
            {"type": "mrkdwn", "text": f"*Category:*\n{cat_emoji} {category.title()}"},
            {"type": "mrkdwn", "text": f"*Assignee:*\nUnassigned"},
            {"type": "mrkdwn", "text": f"*Requester:*\n<@{slack_user_id}>"},
            {"type": "mrkdwn", "text": f"*Ticket #:*\n`{ticket.ticket_number}`"},
        ]},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": f":stopwatch: SLA: {sla_hours}h remaining"}]},
        {"type": "actions", "elements": [
            {"type": "button", "text": {"type": "plain_text", "text": ":eyes: View Ticket", "emoji": True},
             "style": "primary", "url": f"{PORTAL_URL}/dashboard/tickets/{ticket.id}", "action_id": "view_ticket"}
        ]}
    ]


def main():
    log.info("=" * 50)
    log.info("  Mindstorm Helpdesk — Slack Bot v3 (Django ORM)")
    log.info("=" * 50)

    bot_token, app_token = wait_for_settings()
    log.info("Tokens loaded.")

    app = App(token=bot_token)

    @app.command("/helpdesk")
    def handle_helpdesk_command(ack, command, client):
        ack()
        log.info(f"/helpdesk from {command.get('user_name', '?')}")
        try:
            client.views_open(
                trigger_id=command["trigger_id"],
                view={
                    "type": "modal",
                    "callback_id": "create_ticket",
                    "title": {"type": "plain_text", "text": ":ticket: Raise a Ticket", "emoji": True},
                    "submit": {"type": "plain_text", "text": ":rocket: Submit", "emoji": True},
                    "close": {"type": "plain_text", "text": "Cancel"},
                    "blocks": [
                        {"type": "section", "text": {"type": "mrkdwn", "text": ":wave: *Need help?* Fill out the form below and our IT team will assist you."}},
                        {"type": "divider"},
                        {"type": "input", "block_id": "subject_block",
                         "element": {"type": "plain_text_input", "action_id": "subject_input",
                                     "placeholder": {"type": "plain_text", "text": "e.g., Laptop not working, VPN issue..."}},
                         "label": {"type": "plain_text", "text": ":memo: Subject", "emoji": True}},
                        {"type": "input", "block_id": "description_block",
                         "element": {"type": "plain_text_input", "action_id": "desc_input", "multiline": True,
                                     "placeholder": {"type": "plain_text", "text": "Describe your issue in detail..."}},
                         "label": {"type": "plain_text", "text": ":page_facing_up: Description", "emoji": True}, "optional": True},
                        {"type": "input", "block_id": "category_block",
                         "element": {"type": "static_select", "action_id": "cat_select",
                                     "placeholder": {"type": "plain_text", "text": "Choose one..."},
                                     "options": [
                                         {"text": {"type": "plain_text", "text": f"{CATEGORY_EMOJI[v]} {t}", "emoji": True}, "value": v}
                                         for v, t in [("problem","Problem"),("request","Request"),("question","Question"),("incident","Incident"),("bug","Bug Report")]
                                     ]},
                         "label": {"type": "plain_text", "text": ":file_folder: Category", "emoji": True}},
                        {"type": "input", "block_id": "priority_block",
                         "element": {"type": "static_select", "action_id": "pri_select",
                                     "initial_option": {"text": {"type": "plain_text", "text": ":large_yellow_circle: Medium", "emoji": True}, "value": "medium"},
                                     "options": [
                                         {"text": {"type": "plain_text", "text": f"{PRIORITY_EMOJI[v]} {t}", "emoji": True}, "value": v}
                                         for v, t in [("low","Low"),("medium","Medium"),("high","High"),("urgent","Urgent")]
                                     ]},
                         "label": {"type": "plain_text", "text": ":triangular_flag_on_post: Priority", "emoji": True}},
                    ]
                }
            )
        except Exception as e:
            log.error(f"Modal error: {e}", exc_info=True)

    @app.view("create_ticket")
    def handle_ticket_submission(ack, body, client, view):
        ack()
        log.info("Form submitted")
        try:
            values = view["state"]["values"]
            slack_user_id = body["user"]["id"]
            slack_username = body["user"].get("username", "")

            subject = values["subject_block"]["subject_input"]["value"]
            description = values["description_block"]["desc_input"].get("value") or ""
            category = values["category_block"]["cat_select"]["selected_option"]["value"]
            priority = values["priority_block"]["pri_select"]["selected_option"]["value"]

            # Get email from Slack
            email = f"{slack_username}@mindstormstudios.com"
            display_name = slack_username
            try:
                info = client.users_info(user=slack_user_id)
                profile = info["user"].get("profile", {})
                if profile.get("email"):
                    email = profile["email"]
                display_name = profile.get("real_name") or profile.get("display_name") or slack_username
            except Exception:
                pass

            # Create user and ticket using Django ORM
            user = find_or_create_user(email, slack_user_id, display_name)
            ticket = create_ticket_orm(subject, description, category, priority, user)

            # DM the user
            try:
                client.chat_postMessage(
                    channel=slack_user_id,
                    text=f"Ticket {ticket.ticket_number} created!",
                    blocks=build_user_notification(ticket, category, priority)
                )
            except Exception as e:
                log.error(f"User DM error: {e}")

            # Notify IT team channel
            team_channel = AppSetting.get('slack_team_channel_id', '') or AppSetting.get('slack_channel_id', '')
            if team_channel:
                try:
                    result = client.chat_postMessage(
                        channel=team_channel,
                        text=f"New ticket {ticket.ticket_number}: {subject}",
                        blocks=build_team_notification(ticket, category, priority, slack_user_id, display_name)
                    )
                    ticket.slack_channel_id = team_channel
                    ticket.slack_message_ts = result["ts"]
                    ticket.save(update_fields=['slack_channel_id', 'slack_message_ts'])
                except Exception as e:
                    log.error(f"Team notify error: {e}")

            # Notify general channel if different
            notif_channel = AppSetting.get('slack_channel_id', '')
            if notif_channel and notif_channel != team_channel:
                try:
                    client.chat_postMessage(
                        channel=notif_channel,
                        text=f":ticket: `{ticket.ticket_number}` from <@{slack_user_id}>: *{subject}* ({PRIORITY_EMOJI.get(priority,'')} {priority})"
                    )
                except Exception as e:
                    log.error(f"Notif channel error: {e}")

        except Exception as e:
            log.error(f"Ticket error: {e}", exc_info=True)

    @app.action("view_ticket")
    def handle_view_ticket(ack, body):
        ack()

    @app.action("view_portal")
    def handle_view_portal(ack, body):
        ack()

    log.info("Connecting to Slack via Socket Mode...")
    handler = SocketModeHandler(app, app_token)
    handler.start()


if __name__ == "__main__":
    main()
