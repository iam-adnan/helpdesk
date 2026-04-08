from celery import shared_task
import logging, json

logger = logging.getLogger('helpdesk')

@shared_task
def ai_auto_respond(ticket_id):
    from settings_manager.models import AppSetting
    from tickets.models import Ticket, TicketComment
    from accounts.models import User

    if AppSetting.get('ai_enabled', 'true') != 'true':
        return
    api_key = AppSetting.get('anthropic_api_key', '')
    if not api_key:
        return
    try:
        import anthropic
        ticket = Ticket.objects.get(id=ticket_id)
        client = anthropic.Anthropic(api_key=api_key)
        model = AppSetting.get('ai_model', 'claude-sonnet-4-20250514')
        system_prompt = AppSetting.get('ai_system_prompt',
            'You are a helpful IT support assistant. Provide a brief, helpful first response.')

        response = client.messages.create(
            model=model,
            max_tokens=500,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Ticket: {ticket.subject}\nCategory: {ticket.category}\nPriority: {ticket.priority}\n\nDescription:\n{ticket.description}"
            }]
        )
        ai_text = response.content[0].text

        # Get or create AI user
        ai_user, _ = User.objects.get_or_create(
            email='ai-assistant@mindstormstudios.com',
            defaults={'username': 'ai-assistant', 'first_name': 'AI', 'last_name': 'Assistant', 'role': 'agent'}
        )
        TicketComment.objects.create(
            ticket=ticket, author=ai_user,
            content=ai_text, comment_type='ai'
        )
        logger.info(f"AI responded to ticket {ticket.ticket_number}")
    except Exception as e:
        logger.error(f"AI auto-respond error: {e}")

@shared_task
def notify_slack_comment(comment_id):
    from settings_manager.models import AppSetting
    from tickets.models import TicketComment

    bot_token = AppSetting.get('slack_bot_token', '')
    if not bot_token:
        return
    try:
        from slack_sdk import WebClient
        comment = TicketComment.objects.select_related('ticket','author').get(id=comment_id)
        ticket = comment.ticket
        if not ticket.slack_message_ts or not ticket.slack_channel_id:
            return
        client = WebClient(token=bot_token)
        text = f"*{comment.author.first_name or comment.author.email}* ({comment.comment_type}):\n{comment.content}"
        if ticket.status in ('resolved','closed'):
            text = f":white_check_mark: Ticket *{ticket.ticket_number}* has been *{ticket.status}*\n{comment.content}"
        client.chat_postMessage(
            channel=ticket.slack_channel_id,
            thread_ts=ticket.slack_message_ts,
            text=text
        )
    except Exception as e:
        logger.error(f"Slack comment notification error: {e}")
