from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from .models import TicketComment, TicketActivity
import logging

logger = logging.getLogger('helpdesk')


@receiver(post_save, sender=TicketComment)
def on_comment_created(sender, instance, created, **kwargs):
    if not created:
        return
    try:
        TicketActivity.objects.create(
            ticket=instance.ticket,
            user=instance.author,
            action='comment_added',
            new_value=instance.comment_type
        )
        ticket = instance.ticket
        if not ticket.first_response_at and instance.author != ticket.created_by:
            ticket.first_response_at = timezone.now()
            ticket.save(update_fields=['first_response_at'])
    except Exception as e:
        logger.error(f"Signal error (comment): {e}")

    # Queue notifications — fail silently
    try:
        from notifications.tasks import send_comment_notification
        send_comment_notification.delay(str(instance.id))
    except Exception:
        pass

    try:
        from integrations.tasks import notify_slack_comment
        notify_slack_comment.delay(str(instance.id))
    except Exception:
        pass
