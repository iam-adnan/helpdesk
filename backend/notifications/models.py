from django.db import models
from django.conf import settings
import uuid

class NotificationTemplate(models.Model):
    class Channel(models.TextChoices):
        EMAIL = 'email', 'Email'
        SLACK = 'slack', 'Slack'
    class EventType(models.TextChoices):
        TICKET_CREATED = 'ticket_created', 'Ticket Created'
        TICKET_ASSIGNED = 'ticket_assigned', 'Ticket Assigned'
        TICKET_UPDATED = 'ticket_updated', 'Ticket Updated'
        TICKET_COMMENTED = 'ticket_commented', 'Comment Added'
        TICKET_RESOLVED = 'ticket_resolved', 'Ticket Resolved'
        TICKET_CLOSED = 'ticket_closed', 'Ticket Closed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    event_type = models.CharField(max_length=30, choices=EventType.choices)
    channel = models.CharField(max_length=10, choices=Channel.choices)
    subject = models.CharField(max_length=255, blank=True, help_text='For email only')
    body = models.TextField(help_text='Use {{ticket_number}}, {{subject}}, {{status}}, {{user_name}}, {{comment}}')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.channel})"

class Notification(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SENT = 'sent', 'Sent'
        FAILED = 'failed', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=255)
    message = models.TextField()
    channel = models.CharField(max_length=10, choices=NotificationTemplate.Channel.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    read = models.BooleanField(default=False)
    ticket_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
