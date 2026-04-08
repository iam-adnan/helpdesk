import json
import logging
import secrets
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

logger = logging.getLogger('helpdesk')


def get_setting(key, default=''):
    try:
        from settings_manager.models import AppSetting
        return AppSetting.get(key, default)
    except Exception:
        return default


@csrf_exempt
def slack_command(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    logger.info("Slack command received")

    trigger_id = request.POST.get('trigger_id', '')
    user_id = request.POST.get('user_id', '')
    user_name = request.POST.get('user_name', '')

    bot_token = get_setting('slack_bot_token', '')
    if not bot_token:
        return JsonResponse({
            'response_type': 'ephemeral',
            'text': 'Helpdesk not configured. Ask admin to set up Slack integration.'
        })

    if not trigger_id:
        return JsonResponse({
            'response_type': 'ephemeral',
            'text': 'Missing trigger_id.'
        })

    try:
        from slack_sdk import WebClient
        client = WebClient(token=bot_token)
        client.views_open(
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
                        "element": {"type": "plain_text_input", "action_id": "subject_input",
                                    "placeholder": {"type": "plain_text", "text": "Brief summary"}},
                        "label": {"type": "plain_text", "text": "Subject"}
                    },
                    {
                        "type": "input", "block_id": "description_block",
                        "element": {"type": "plain_text_input", "action_id": "desc_input", "multiline": True},
                        "label": {"type": "plain_text", "text": "Description"},
                        "optional": True
                    },
                    {
                        "type": "input", "block_id": "category_block",
                        "element": {
                            "type": "static_select", "action_id": "cat_select",
                            "options": [
                                {"text": {"type": "plain_text", "text": t}, "value": v}
                                for v, t in [("problem","Problem"),("request","Request"),("question","Question"),("incident","Incident"),("bug","Bug Report")]
                            ]
                        },
                        "label": {"type": "plain_text", "text": "Category"}
                    },
                    {
                        "type": "input", "block_id": "priority_block",
                        "element": {
                            "type": "static_select", "action_id": "pri_select",
                            "initial_option": {"text": {"type": "plain_text", "text": "Medium"}, "value": "medium"},
                            "options": [
                                {"text": {"type": "plain_text", "text": t}, "value": v}
                                for v, t in [("low","Low"),("medium","Medium"),("high","High"),("urgent","Urgent")]
                            ]
                        },
                        "label": {"type": "plain_text", "text": "Priority"}
                    },
                ]
            }
        )
        logger.info("Modal opened")
    except Exception as e:
        logger.error(f"Slack error: {e}", exc_info=True)
        return JsonResponse({'response_type': 'ephemeral', 'text': f'Error: {e}'})

    return JsonResponse({})


@csrf_exempt
def slack_interaction(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    logger.info("Slack interaction received")

    try:
        payload = json.loads(request.POST.get('payload', '{}'))
    except Exception:
        return JsonResponse({})

    if payload.get('type') != 'view_submission':
        return JsonResponse({})
    if payload.get('view', {}).get('callback_id') != 'create_ticket':
        return JsonResponse({})

    try:
        values = payload['view']['state']['values']
        slack_user_id = payload['user']['id']
        slack_username = payload['user'].get('username', '')

        subject = values['subject_block']['subject_input']['value']
        description = values['description_block']['desc_input'].get('value') or ''
        category = values['category_block']['cat_select']['selected_option']['value']
        priority = values['priority_block']['pri_select']['selected_option']['value']

        bot_token = get_setting('slack_bot_token', '')
        email = f"{slack_username}@mindstormstudios.com"

        if bot_token:
            try:
                from slack_sdk import WebClient
                info = WebClient(token=bot_token).users_info(user=slack_user_id)
                profile_email = info['user'].get('profile', {}).get('email', '')
                if profile_email:
                    email = profile_email
            except Exception:
                pass

        from accounts.models import User
        user, created = User.objects.get_or_create(
            email=email.lower(),
            defaults={
                'username': email.split('@')[0],
                'first_name': email.split('@')[0].replace('.', ' ').title(),
                'slack_user_id': slack_user_id,
            }
        )
        if created:
            user.set_password(secrets.token_urlsafe(16))
            user.save()

        if not user.slack_user_id:
            user.slack_user_id = slack_user_id
            user.save(update_fields=['slack_user_id'])

        from tickets.models import Ticket, TicketActivity
        ticket = Ticket.objects.create(
            subject=subject, description=description,
            category=category, priority=priority, created_by=user,
        )
        TicketActivity.objects.create(
            ticket=ticket, user=user,
            action='created', new_value=f'{ticket.ticket_number} (via Slack)'
        )
        logger.info(f"Ticket created: {ticket.ticket_number}")

        channel_id = get_setting('slack_channel_id', '')
        if bot_token and channel_id:
            try:
                from slack_sdk import WebClient
                result = WebClient(token=bot_token).chat_postMessage(
                    channel=channel_id,
                    text=f":ticket: *{ticket.ticket_number}*\n*Subject:* {subject}\n*Category:* {category} | *Priority:* {priority}\n*By:* <@{slack_user_id}>",
                )
                ticket.slack_channel_id = channel_id
                ticket.slack_message_ts = result['ts']
                ticket.save(update_fields=['slack_channel_id', 'slack_message_ts'])
            except Exception as e:
                logger.error(f"Slack post error: {e}")

        try:
            from integrations.tasks import ai_auto_respond
            ai_auto_respond.delay(str(ticket.id))
        except Exception:
            pass

    except Exception as e:
        logger.error(f"Interaction error: {e}", exc_info=True)

    return JsonResponse({})
