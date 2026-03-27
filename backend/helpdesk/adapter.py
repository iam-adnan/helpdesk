import logging
from django.conf import settings
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter

logger = logging.getLogger(__name__)


class MindstormSocialAdapter(DefaultSocialAccountAdapter):

    def pre_social_login(self, request, sociallogin):
        email = ''
        if sociallogin.account.extra_data:
            email = sociallogin.account.extra_data.get('email', '')
        if not email and sociallogin.user:
            email = getattr(sociallogin.user, 'email', '')

        allowed_domain = getattr(settings, 'ALLOWED_EMAIL_DOMAIN', 'mindstormstudios.com')
        frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost')

        logger.info(f'Social login attempt: {email}')

        if not email.lower().endswith(f'@{allowed_domain}'):
            logger.warning(f'Blocked unauthorized login: {email}')
            from django.shortcuts import redirect
            from allauth.exceptions import ImmediateHttpResponse
            raise ImmediateHttpResponse(
                redirect(f'{frontend_url}/login?error=unauthorized')
            )

        # Connect to existing account
        from helpdesk.models import User
        try:
            existing = User.objects.get(email=email)
            if not sociallogin.is_existing:
                sociallogin.connect(request, existing)
        except User.DoesNotExist:
            pass

    def is_open_for_signup(self, request, sociallogin):
        email = sociallogin.account.extra_data.get('email', '')
        allowed_domain = getattr(settings, 'ALLOWED_EMAIL_DOMAIN', 'mindstormstudios.com')
        return email.lower().endswith(f'@{allowed_domain}')

    def save_user(self, request, sociallogin, form=None):
        user = super().save_user(request, sociallogin, form)
        extra = sociallogin.account.extra_data or {}

        user.google_id = extra.get('sub') or sociallogin.account.uid
        user.avatar = extra.get('picture', '')

        if not user.first_name:
            user.first_name = extra.get('given_name', '')
        if not user.last_name:
            user.last_name = extra.get('family_name', '')

        if not user.username or '@' in user.username:
            user.username = user.email.split('@')[0].replace('.', '_')

        from helpdesk.models import User as UserModel
        if not UserModel.objects.filter(role='admin').exists():
            user.role = 'admin'
            user.is_staff = True
            user.is_superuser = True

        user.save()
        logger.info(f'User saved: {user.email} role={user.role}')
        return user

    def populate_user(self, request, sociallogin, data):
        user = super().populate_user(request, sociallogin, data)
        extra = sociallogin.account.extra_data or {}
        if extra.get('email'):
            user.email = extra['email']
        if extra.get('given_name'):
            user.first_name = extra['given_name']
        if extra.get('family_name'):
            user.last_name = extra['family_name']
        if not user.username:
            user.username = user.email.split('@')[0].replace('.', '_')
        return user
