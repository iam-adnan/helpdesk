from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend

User = get_user_model()

class EmailBackend(ModelBackend):
    """Custom auth backend that authenticates using email instead of username."""
    def authenticate(self, request, email=None, password=None, username=None, **kwargs):
        # Support both email and username parameters
        lookup = email or username
        if lookup is None:
            return None
        try:
            user = User.objects.get(email=lookup.lower())
        except User.DoesNotExist:
            # Run the default password hasher to prevent timing attacks
            User().set_password(password)
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
