from django.contrib.auth.models import AbstractUser
from django.db import models
import uuid
import logging

logger = logging.getLogger('helpdesk')


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = 'admin', 'Admin'
        AGENT = 'agent', 'Agent'
        USER = 'user', 'User'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.USER)
    department = models.CharField(max_length=100, blank=True, default='')
    phone = models.CharField(max_length=20, blank=True, default='')
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    slack_user_id = models.CharField(max_length=50, blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.email

    @property
    def is_admin(self):
        return self.role == self.Role.ADMIN

    @property
    def is_agent(self):
        return self.role in (self.Role.ADMIN, self.Role.AGENT)

    def save(self, *args, **kwargs):
        if self.email:
            self.email = self.email.lower().strip()

        if not self.username and self.email:
            base = self.email.split('@')[0]
            self.username = base
            counter = 1
            while User.objects.filter(username=self.username).exclude(pk=self.pk).exists():
                self.username = f"{base}{counter}"
                counter += 1

        # First user becomes admin
        is_new = self._state.adding
        if is_new:
            existing_count = User.objects.count()
            if existing_count == 0:
                logger.info(f"FIRST USER: {self.email} -> auto ADMIN")
                self.role = self.Role.ADMIN
                self.is_staff = True
                self.is_superuser = True

        super().save(*args, **kwargs)
