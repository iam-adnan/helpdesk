import random
import string
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


def generate_ticket_number():
    now = timezone.now()
    suffix = ''.join(random.choices(string.digits, k=4))
    return f"MS-{now.strftime('%y%m')}-{suffix}"


def attachment_path(instance, filename):
    return f'attachments/ticket_{instance.ticket.id}/{filename}'


class User(AbstractUser):
    ROLES = [('user', 'User'), ('admin', 'Admin')]
    email = models.EmailField(unique=True)
    google_id = models.CharField(max_length=128, blank=True, null=True, unique=True)
    avatar = models.URLField(blank=True, null=True, max_length=500)
    role = models.CharField(max_length=10, choices=ROLES, default='user')
    slack_user_id = models.CharField(max_length=32, blank=True, null=True, unique=True)
    slack_dm_channel = models.CharField(max_length=32, blank=True, null=True)
    notify_slack = models.BooleanField(default=True)
    notify_email = models.BooleanField(default=False)
    last_login_at = models.DateTimeField(null=True, blank=True)
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    def __str__(self): return self.email

    @property
    def is_admin(self): return self.role == 'admin'

    def display_name(self):
        full = f"{self.first_name} {self.last_name}".strip()
        return full or self.email.split('@')[0]

    def get_full_name(self):
        return self.display_name()


class SLAPolicy(models.Model):
    name = models.CharField(max_length=100)
    priority = models.CharField(max_length=10, unique=True)
    response_hours = models.FloatField()
    resolve_hours = models.FloatField()
    is_active = models.BooleanField(default=True)
    class Meta: ordering = ['response_hours']
    def __str__(self): return f'{self.name} ({self.priority})'


class AutoAssignRule(models.Model):
    category = models.CharField(max_length=20, unique=True)
    assign_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='auto_assignments')
    is_active = models.BooleanField(default=True)
    def __str__(self): return f'{self.category} -> {self.assign_to}'


class CannedResponse(models.Model):
    title = models.CharField(max_length=200)
    content = models.TextField()
    category = models.CharField(max_length=20, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    use_count = models.PositiveIntegerField(default=0)
    class Meta: ordering = ['-use_count', 'title']
    def __str__(self): return self.title


class Ticket(models.Model):
    PRIORITIES = [('low','Low'),('medium','Medium'),('high','High'),('critical','Critical')]
    STATUSES = [('open','Open'),('in_progress','In Progress'),('pending','Pending User'),('resolved','Resolved'),('closed','Closed')]
    CATEGORIES = [('hardware','Hardware'),('software','Software'),('network','Network'),('access','Access / Permissions'),('email','Email'),('other','Other')]

    ticket_number = models.CharField(max_length=20, unique=True, editable=False)
    title = models.CharField(max_length=255)
    description = models.TextField()
    category = models.CharField(max_length=20, choices=CATEGORIES, default='other')
    priority = models.CharField(max_length=10, choices=PRIORITIES, default='medium')
    status = models.CharField(max_length=15, choices=STATUSES, default='open')

    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tickets_created')
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='tickets_assigned')

    sla_policy = models.ForeignKey(SLAPolicy, on_delete=models.SET_NULL, null=True, blank=True)
    sla_response_due = models.DateTimeField(null=True, blank=True)
    sla_resolve_due = models.DateTimeField(null=True, blank=True)
    sla_response_breached = models.BooleanField(default=False)
    sla_resolve_breached = models.BooleanField(default=False)
    first_response_at = models.DateTimeField(null=True, blank=True)

    slack_channel_ts = models.CharField(max_length=64, blank=True, null=True)
    slack_thread_ts = models.CharField(max_length=64, blank=True, null=True)
    source = models.CharField(max_length=10, default='web', choices=[('web','Web'),('slack','Slack')])

    merged_into = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='merged_from')
    is_merged = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta: ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.ticket_number:
            for _ in range(10):
                tn = generate_ticket_number()
                if not Ticket.objects.filter(ticket_number=tn).exists():
                    self.ticket_number = tn
                    break
        super().save(*args, **kwargs)

    def __str__(self): return f'{self.ticket_number}: {self.title}'

    @property
    def sla_response_overdue(self):
        if self.first_response_at: return False
        if self.sla_response_due: return timezone.now() > self.sla_response_due
        return False

    @property
    def sla_resolve_overdue(self):
        if self.status in ('resolved', 'closed'): return False
        if self.sla_resolve_due: return timezone.now() > self.sla_resolve_due
        return False


class TicketLink(models.Model):
    TYPES = [('related','Related to'),('duplicate','Duplicate of'),('blocks','Blocks'),('blocked_by','Blocked by')]
    from_ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='links_from')
    to_ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='links_to')
    link_type = models.CharField(max_length=20, choices=TYPES, default='related')
    created_by = models.ForeignKey(User, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: unique_together = ('from_ticket', 'to_ticket', 'link_type')


class Attachment(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='attachments')
    uploaded_by = models.ForeignKey(User, on_delete=models.CASCADE)
    file = models.FileField(upload_to=attachment_path)
    filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField(default=0)
    mime_type = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    def __str__(self): return self.filename


class Comment(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comments')
    content = models.TextField()
    is_internal = models.BooleanField(default=False)
    slack_ts = models.CharField(max_length=64, blank=True, null=True)
    source = models.CharField(max_length=10, default='web', choices=[('web','Web'),('slack','Slack')])
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ['created_at']


class TicketHistory(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='history')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    action = models.CharField(max_length=50)
    old_value = models.CharField(max_length=255, blank=True, null=True)
    new_value = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ['created_at']


class NotificationLog(models.Model):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name='notifications')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE)
    channel = models.CharField(max_length=10, choices=[('slack','Slack'),('email','Email')])
    event = models.CharField(max_length=50)
    status = models.CharField(max_length=10, choices=[('sent','Sent'),('failed','Failed'),('skipped','Skipped')], default='sent')
    error = models.TextField(blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)
    class Meta: ordering = ['-sent_at']
