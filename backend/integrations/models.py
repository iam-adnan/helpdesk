from django.db import models
import uuid

class SlackInstallation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    team_id = models.CharField(max_length=50, unique=True)
    team_name = models.CharField(max_length=100)
    bot_token = models.CharField(max_length=255)
    channel_id = models.CharField(max_length=50, blank=True)
    channel_name = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.team_name
