from celery import shared_task
from django.conf import settings
import logging

logger = logging.getLogger('helpdesk')

@shared_task
def send_comment_notification(comment_id):
    from tickets.models import TicketComment
    from .models import Notification, NotificationTemplate
    try:
        comment = TicketComment.objects.select_related('ticket','author','ticket__created_by').get(id=comment_id)
        ticket = comment.ticket
        # Notify ticket creator if comment is from someone else
        if comment.author != ticket.created_by and comment.comment_type == 'public':
            Notification.objects.create(
                user=ticket.created_by,
                title=f'New reply on {ticket.ticket_number}',
                message=f'{comment.author.first_name or comment.author.email}: {comment.content[:200]}',
                channel='email',
                ticket_id=ticket.id,
                status='sent'
            )
        # Notify assigned agent
        if ticket.assigned_to and comment.author != ticket.assigned_to and comment.comment_type == 'public':
            Notification.objects.create(
                user=ticket.assigned_to,
                title=f'New reply on {ticket.ticket_number}',
                message=f'{comment.author.first_name or comment.author.email}: {comment.content[:200]}',
                channel='email',
                ticket_id=ticket.id,
                status='sent'
            )
        # Send email if configured
        _send_email_notification(ticket, comment)
    except Exception as e:
        logger.error(f"Comment notification error: {e}")

def _send_email_notification(ticket, comment):
    from settings_manager.models import AppSetting
    try:
        smtp_host = AppSetting.get('smtp_host', '')
        if not smtp_host:
            return
        import smtplib
        from email.mime.text import MIMEText
        smtp_port = int(AppSetting.get('smtp_port', '587'))
        smtp_user = AppSetting.get('smtp_user', '')
        smtp_pass = AppSetting.get('smtp_password', '')
        from_email = AppSetting.get('smtp_from_email', smtp_user)

        msg = MIMEText(f"Ticket {ticket.ticket_number}: {ticket.subject}\n\nNew comment from {comment.author.email}:\n{comment.content}")
        msg['Subject'] = f"Re: [{ticket.ticket_number}] {ticket.subject}"
        msg['From'] = from_email
        msg['To'] = ticket.created_by.email

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            if smtp_port == 587:
                server.starttls()
            if smtp_user:
                server.login(smtp_user, smtp_pass)
            server.send_message(msg)
    except Exception as e:
        logger.error(f"Email send error: {e}")

@shared_task
def send_ticket_created_notification(ticket_id):
    from tickets.models import Ticket
    from .models import Notification
    try:
        ticket = Ticket.objects.get(id=ticket_id)
        Notification.objects.create(
            user=ticket.created_by,
            title=f'Ticket {ticket.ticket_number} created',
            message=f'Your ticket "{ticket.subject}" has been created and assigned to {ticket.support_team}.',
            channel='email',
            ticket_id=ticket.id,
            status='sent'
        )
    except Exception as e:
        logger.error(f"Ticket created notification error: {e}")
