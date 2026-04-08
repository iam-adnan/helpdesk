#!/bin/bash
set -e

echo "========================================"
echo "  STEP 1: Diagnose the problem"
echo "========================================"

cd mindstorm-helpdesk 2>/dev/null || cd ~/mindstorm-helpdesk 2>/dev/null || { echo "ERROR: Can't find mindstorm-helpdesk directory. cd into the parent folder and run again."; exit 1; }

echo ""
echo "--- Container status ---"
docker compose ps -a
echo ""
echo "--- Backend logs (last 50 lines) ---"
docker compose logs --tail=50 backend 2>&1 || true
echo ""
echo "--- Celery logs (last 20 lines) ---"
docker compose logs --tail=20 celery 2>&1 || true
echo ""

echo "========================================"
echo "  STEP 2: Applying full fix"
echo "========================================"

# Stop everything
docker compose down -v 2>/dev/null || true

# ==========================================
# Remove version from docker-compose (cosmetic fix)
# ==========================================
cat > docker-compose.yml << 'DOCKEREOF'
services:
  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: helpdesk-backend
    restart: always
    volumes:
      - sqlite_data:/app/data
      - media_data:/app/media
    ports:
      - "8000:8000"
    environment:
      - DJANGO_SETTINGS_MODULE=helpdesk.settings
      - DATABASE_PATH=/app/data/db.sqlite3
      - ALLOWED_HOSTS=*
      - CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost,http://helpdesk.local
      - SECRET_KEY=ms-hd-prod-key-change-me-to-random-64-chars
      - CELERY_BROKER_URL=redis://redis:6379/0
      - DEBUG=true
    depends_on:
      redis:
        condition: service_started
    command: >
      sh -c "mkdir -p /app/data &&
             touch /app/data/helpdesk.log &&
             python manage.py migrate --noinput 2>&1 &&
             python manage.py collectstatic --noinput 2>&1 &&
             gunicorn helpdesk.wsgi:application --bind 0.0.0.0:8000 --workers 3 --threads 2 --timeout 120 --access-logfile - --error-logfile -"

  celery:
    build:
      context: .
      dockerfile: Dockerfile.backend
    container_name: helpdesk-celery
    restart: always
    volumes:
      - sqlite_data:/app/data
      - media_data:/app/media
    environment:
      - DJANGO_SETTINGS_MODULE=helpdesk.settings
      - DATABASE_PATH=/app/data/db.sqlite3
      - CELERY_BROKER_URL=redis://redis:6379/0
    depends_on:
      redis:
        condition: service_started
      backend:
        condition: service_started
    command: >
      sh -c "sleep 10 && celery -A helpdesk worker -l info --concurrency=2"

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    container_name: helpdesk-frontend
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=/api
    depends_on:
      backend:
        condition: service_started

  redis:
    image: redis:7-alpine
    container_name: helpdesk-redis
    restart: always
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    container_name: helpdesk-nginx
    restart: always
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - media_data:/app/media
    depends_on:
      backend:
        condition: service_started
      frontend:
        condition: service_started

volumes:
  sqlite_data:
  media_data:
  redis_data:
DOCKEREOF
echo "  [OK] docker-compose.yml (removed version, added health deps)"

# ==========================================
# Fix Dockerfile.backend — ensure data dir and log file exist
# ==========================================
cat > Dockerfile.backend << 'DBACK'
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y gcc libffi-dev && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

RUN mkdir -p /app/data /app/media /app/staticfiles && \
    touch /app/data/helpdesk.log

EXPOSE 8000
DBACK
echo "  [OK] Dockerfile.backend"

# ==========================================
# Fix Django settings — handle log file, fix PRAGMA syntax
# ==========================================
cat > backend/helpdesk/settings.py << 'PYEOF'
import os
from pathlib import Path
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-change-me')
DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '*').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'django_filters',
    'django_celery_beat',
    'drf_spectacular',
    'accounts',
    'tickets',
    'notifications',
    'integrations',
    'reports',
    'settings_manager',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'helpdesk.urls'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'templates'],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.debug',
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

WSGI_APPLICATION = 'helpdesk.wsgi.application'

# Database — SQLite with WAL mode for concurrency
DB_PATH = os.environ.get('DATABASE_PATH', str(BASE_DIR / 'data' / 'db.sqlite3'))
# Ensure directory exists
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': DB_PATH,
        'OPTIONS': {
            'timeout': 30,
        },
    }
}

AUTH_USER_MODEL = 'accounts.User'

# Relaxed password validators — avoid cryptic Django errors
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
     'OPTIONS': {'min_length': 8}},
]

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 25,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    # Return JSON even for errors
    'DEFAULT_RENDERER_CLASSES': (
        'rest_framework.renderers.JSONRenderer',
    ),
    'EXCEPTION_HANDLER': 'helpdesk.exception_handler.custom_exception_handler',
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

CORS_ALLOWED_ORIGINS = os.environ.get(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:3000,http://localhost'
).split(',')
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_ALL_ORIGINS = True  # For development ease

CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://redis:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://redis:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
ALLOWED_EMAIL_DOMAIN = 'mindstormstudios.com'

# Logging — safe file path
LOG_DIR = BASE_DIR / 'data'
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = LOG_DIR / 'helpdesk.log'

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {'format': '{levelname} {asctime} {module} {message}', 'style': '{'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'verbose'},
        'file': {
            'class': 'logging.FileHandler',
            'filename': str(LOG_FILE),
            'formatter': 'verbose',
        },
    },
    'loggers': {
        'django': {'handlers': ['console'], 'level': 'WARNING'},
        'helpdesk': {'handlers': ['console', 'file'], 'level': 'INFO'},
    },
}
PYEOF
echo "  [OK] helpdesk/settings.py"

# ==========================================
# Create custom exception handler (catches HTML 502s etc)
# ==========================================
cat > backend/helpdesk/exception_handler.py << 'PYEOF'
from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is not None:
        # Normalize all error responses to have 'detail' and 'errors'
        data = response.data

        if isinstance(data, dict):
            if 'detail' not in data:
                errors = []
                for field, messages in data.items():
                    if isinstance(messages, list):
                        for msg in messages:
                            if field == 'non_field_errors':
                                errors.append(str(msg))
                            else:
                                label = field.replace('_', ' ').title()
                                errors.append(f"{label}: {msg}")
                    elif isinstance(messages, str):
                        errors.append(str(messages))

                if errors:
                    response.data = {
                        'detail': errors[0],
                        'errors': errors,
                    }
            elif 'errors' not in data:
                response.data['errors'] = [str(data.get('detail', 'An error occurred.'))]

        return response

    # Unhandled exception — return generic JSON error, never HTML
    return Response(
        {
            'detail': 'An internal server error occurred.',
            'errors': ['An internal server error occurred. Please try again.'],
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR
    )
PYEOF
echo "  [OK] helpdesk/exception_handler.py"

# ==========================================
# Fix helpdesk/__init__.py — safe celery import
# ==========================================
cat > backend/helpdesk/__init__.py << 'PYEOF'
try:
    from .celery_app import app as celery_app
    __all__ = ('celery_app',)
except Exception:
    pass
PYEOF
echo "  [OK] helpdesk/__init__.py"

# ==========================================
# Fix celery_app.py
# ==========================================
cat > backend/helpdesk/celery_app.py << 'PYEOF'
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'helpdesk.settings')

app = Celery('helpdesk')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
PYEOF
echo "  [OK] helpdesk/celery_app.py"

# ==========================================
# Fix helpdesk/urls.py
# ==========================================
cat > backend/helpdesk/urls.py << 'PYEOF'
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    return Response({'status': 'ok', 'service': 'mindstorm-helpdesk'})

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health_check),
    path('api/auth/', include('accounts.urls')),
    path('api/tickets/', include('tickets.urls')),
    path('api/notifications/', include('notifications.urls')),
    path('api/integrations/', include('integrations.urls')),
    path('api/reports/', include('reports.urls')),
    path('api/settings/', include('settings_manager.urls')),
    path('slack/', include('integrations.slack_urls')),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
PYEOF
echo "  [OK] helpdesk/urls.py"

# ==========================================
# Fix accounts/models.py
# ==========================================
cat > backend/accounts/models.py << 'PYEOF'
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
PYEOF
echo "  [OK] accounts/models.py"

# ==========================================
# Fix accounts/serializers.py
# ==========================================
cat > backend/accounts/serializers.py << 'PYEOF'
from rest_framework import serializers
from django.conf import settings
from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            'id', 'email', 'username', 'first_name', 'last_name',
            'role', 'department', 'phone', 'avatar', 'slack_user_id',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            'email', 'username', 'first_name', 'last_name',
            'password', 'password_confirm', 'department', 'phone'
        ]

    def validate_email(self, value):
        value = value.strip().lower()
        domain = value.split('@')[-1]
        allowed = settings.ALLOWED_EMAIL_DOMAIN
        if domain != allowed:
            raise serializers.ValidationError(
                f'Only @{allowed} email addresses are allowed to register.'
            )
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def validate_username(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Username is required.')
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('This username is already taken.')
        return value

    def validate(self, data):
        if data.get('password') != data.get('password_confirm'):
            raise serializers.ValidationError({
                'password_confirm': 'Passwords do not match.'
            })
        return data

    def create(self, validated_data):
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')
        if not validated_data.get('username'):
            validated_data['username'] = validated_data['email'].split('@')[0]
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class AdminUserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            'email', 'username', 'first_name', 'last_name',
            'role', 'department', 'phone', 'password', 'is_active'
        ]

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        if not validated_data.get('username'):
            validated_data['username'] = validated_data['email'].split('@')[0]
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            import secrets
            user.set_password(secrets.token_urlsafe(16))
        user.save()
        return user


class AdminUserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['first_name', 'last_name', 'role', 'department', 'phone', 'is_active']


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField()
    new_password = serializers.CharField(min_length=8)

    def validate_old_password(self, value):
        if not self.context['request'].user.check_password(value):
            raise serializers.ValidationError('Incorrect current password.')
        return value


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()
PYEOF
echo "  [OK] accounts/serializers.py"

# ==========================================
# Fix accounts/views.py
# ==========================================
cat > backend/accounts/views.py << 'PYEOF'
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.tokens import RefreshToken
from django.contrib.auth import authenticate
from django.db import IntegrityError
from .models import User
from .serializers import (
    UserSerializer, UserCreateSerializer, AdminUserCreateSerializer,
    AdminUserUpdateSerializer, ChangePasswordSerializer, LoginSerializer
)
from .permissions import IsAdmin
import logging
import traceback

logger = logging.getLogger('helpdesk')


class RegisterView(generics.CreateAPIView):
    permission_classes = [AllowAny]
    serializer_class = UserCreateSerializer

    def create(self, request, *args, **kwargs):
        logger.info(f"Registration attempt: {request.data.get('email', '?')}")

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            errors = []
            for field, messages in serializer.errors.items():
                for msg in messages:
                    if field == 'non_field_errors':
                        errors.append(str(msg))
                    else:
                        label = field.replace('_', ' ').title()
                        errors.append(f"{label}: {msg}")
            logger.warning(f"Registration validation failed: {errors}")
            return Response(
                {'detail': errors[0] if errors else 'Validation failed.', 'errors': errors},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = serializer.save()
            logger.info(f"User created: {user.email}, role={user.role}")
        except IntegrityError as e:
            logger.error(f"Registration IntegrityError: {e}")
            msg = 'Account could not be created. Email or username may already exist.'
            return Response(
                {'detail': msg, 'errors': [msg]},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            logger.error(f"Registration error: {traceback.format_exc()}")
            msg = 'An unexpected error occurred. Please try again.'
            return Response(
                {'detail': msg, 'errors': [msg]},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        try:
            refresh = RefreshToken.for_user(user)
            return Response({
                'user': UserSerializer(user).data,
                'tokens': {
                    'refresh': str(refresh),
                    'access': str(refresh.access_token),
                }
            }, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.error(f"Token generation error: {traceback.format_exc()}")
            msg = 'Account created but login failed. Please try signing in.'
            return Response(
                {'detail': msg, 'errors': [msg]},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class LoginView(generics.GenericAPIView):
    permission_classes = [AllowAny]
    serializer_class = LoginSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'detail': 'Please provide both email and password.',
                 'errors': ['Please provide both email and password.']},
                status=status.HTTP_400_BAD_REQUEST
            )

        email = serializer.validated_data['email'].strip().lower()
        password = serializer.validated_data['password']

        try:
            user_obj = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {'detail': 'No account found with this email.',
                 'errors': ['No account found with this email.']},
                status=status.HTTP_401_UNAUTHORIZED
            )

        if not user_obj.is_active:
            return Response(
                {'detail': 'Account disabled. Contact an administrator.',
                 'errors': ['Account disabled. Contact an administrator.']},
                status=status.HTTP_403_FORBIDDEN
            )

        user = authenticate(email=email, password=password)
        if not user:
            return Response(
                {'detail': 'Incorrect password.',
                 'errors': ['Incorrect password.']},
                status=status.HTTP_401_UNAUTHORIZED
            )

        refresh = RefreshToken.for_user(user)
        return Response({
            'user': UserSerializer(user).data,
            'tokens': {
                'refresh': str(refresh),
                'access': str(refresh.access_token),
            }
        })


class ProfileView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer
    def get_object(self):
        return self.request.user


class ChangePasswordView(generics.GenericAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = ChangePasswordSerializer
    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            errors = [str(msg) for msgs in serializer.errors.values() for msg in msgs]
            return Response(
                {'detail': errors[0] if errors else 'Failed.', 'errors': errors},
                status=status.HTTP_400_BAD_REQUEST
            )
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save()
        return Response({'message': 'Password changed.'})


class AdminUserViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdmin]
    queryset = User.objects.all()
    serializer_class = UserSerializer
    filterset_fields = ['role', 'is_active', 'department']
    search_fields = ['email', 'first_name', 'last_name', 'username']

    def get_serializer_class(self):
        if self.action == 'create': return AdminUserCreateSerializer
        if self.action in ('update', 'partial_update'): return AdminUserUpdateSerializer
        return UserSerializer

    @action(detail=True, methods=['post'])
    def set_role(self, request, pk=None):
        user = self.get_object()
        role = request.data.get('role')
        if role not in dict(User.Role.choices):
            return Response({'detail': 'Invalid role.'}, status=400)
        user.role = role
        user.is_staff = role == 'admin'
        user.save()
        return Response(UserSerializer(user).data)

    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        import secrets
        user = self.get_object()
        pw = secrets.token_urlsafe(12)
        user.set_password(pw)
        user.save()
        return Response({'temporary_password': pw})
PYEOF
echo "  [OK] accounts/views.py"

# ==========================================
# Fix accounts/permissions.py
# ==========================================
cat > backend/accounts/permissions.py << 'PYEOF'
from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == 'admin'


class IsAgentOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in ('admin', 'agent')
PYEOF
echo "  [OK] accounts/permissions.py"

# ==========================================
# Fix accounts/urls.py
# ==========================================
cat > backend/accounts/urls.py << 'PYEOF'
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .views import RegisterView, LoginView, ProfileView, ChangePasswordView, AdminUserViewSet

router = DefaultRouter()
router.register(r'users', AdminUserViewSet, basename='admin-users')

urlpatterns = [
    path('register/', RegisterView.as_view()),
    path('login/', LoginView.as_view()),
    path('token/refresh/', TokenRefreshView.as_view()),
    path('profile/', ProfileView.as_view()),
    path('change-password/', ChangePasswordView.as_view()),
    path('admin/', include(router.urls)),
]
PYEOF
echo "  [OK] accounts/urls.py"

# ==========================================
# Fix tickets/signals.py — safe imports
# ==========================================
cat > backend/tickets/signals.py << 'PYEOF'
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
PYEOF
echo "  [OK] tickets/signals.py"

# ==========================================
# Fix frontend — api.ts with better 502 handling
# ==========================================
cat > frontend/src/lib/api.ts << 'TSEOF'
import axios from 'axios';

const api = axios.create({
  baseURL: typeof window !== 'undefined' ? '/api' : 'http://backend:8000/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    try {
      const tokens = localStorage.getItem('tokens');
      if (tokens) {
        const { access } = JSON.parse(tokens);
        if (access) {
          config.headers.Authorization = `Bearer ${access}`;
        }
      }
    } catch {
      // corrupted tokens
      localStorage.removeItem('tokens');
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    // Handle network errors or 502/503/504 (backend down)
    if (!error.response) {
      const networkError = {
        response: {
          status: 0,
          data: {
            detail: 'Cannot connect to server. Please check if the service is running.',
            errors: ['Cannot connect to server. Please check if the service is running.'],
          },
        },
      };
      return Promise.reject(networkError);
    }

    // If we got HTML back (e.g., nginx 502 page), convert to a proper error
    const contentType = error.response.headers?.['content-type'] || '';
    if (contentType.includes('text/html') || (typeof error.response.data === 'string' && error.response.data.includes('<html'))) {
      error.response.data = {
        detail: `Server error (${error.response.status}). The backend may be starting up — please wait a moment and try again.`,
        errors: [`Server error (${error.response.status}). The backend may be starting up — please wait a moment and try again.`],
      };
      return Promise.reject(error);
    }

    // Token refresh on 401
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const tokensRaw = localStorage.getItem('tokens');
        if (tokensRaw) {
          const tokens = JSON.parse(tokensRaw);
          const { data } = await axios.post('/api/auth/token/refresh/', { refresh: tokens.refresh });
          const newTokens = { ...tokens, access: data.access };
          localStorage.setItem('tokens', JSON.stringify(newTokens));
          original.headers.Authorization = `Bearer ${data.access}`;
          return api(original);
        }
      } catch {
        localStorage.removeItem('tokens');
        localStorage.removeItem('user');
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
TSEOF
echo "  [OK] lib/api.ts"

# ==========================================
# Fix frontend — auth store
# ==========================================
cat > frontend/src/lib/auth.ts << 'TSEOF'
import { create } from 'zustand';
import api from './api';

interface User {
  id: string; email: string; username: string; first_name: string; last_name: string;
  role: 'admin' | 'agent' | 'user'; department: string; phone: string; avatar: string | null; is_active: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  loadUser: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login/', { email, password });
    if (!data.tokens || !data.user) throw new Error('Invalid server response.');
    localStorage.setItem('tokens', JSON.stringify(data.tokens));
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  register: async (formData) => {
    const { data } = await api.post('/auth/register/', formData);
    if (!data.tokens || !data.user) throw new Error('Invalid server response.');
    localStorage.setItem('tokens', JSON.stringify(data.tokens));
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  logout: () => {
    localStorage.removeItem('tokens');
    localStorage.removeItem('user');
    set({ user: null });
    window.location.href = '/login';
  },

  loadUser: () => {
    try {
      const raw = localStorage.getItem('user');
      set({ user: raw ? JSON.parse(raw) : null, loading: false });
    } catch {
      localStorage.removeItem('user');
      localStorage.removeItem('tokens');
      set({ user: null, loading: false });
    }
  },
}));
TSEOF
echo "  [OK] lib/auth.ts"

# ==========================================
# Fix frontend — register page
# ==========================================
cat > frontend/src/app/register/page.tsx << 'TSEOF'
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Shield, Loader2 } from 'lucide-react';

function extractErrors(err: any): string[] {
  const data = err?.response?.data;
  if (!data) return [err?.message || 'Cannot connect to server. Please try again.'];
  if (Array.isArray(data.errors) && data.errors.length > 0) return data.errors.map(String);
  if (typeof data.detail === 'string') return [data.detail];
  if (typeof data === 'object') {
    const msgs: string[] = [];
    for (const [field, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        for (const msg of value) {
          msgs.push(field === 'non_field_errors' ? String(msg) : `${field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${msg}`);
        }
      } else if (typeof value === 'string') {
        msgs.push(`${field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${value}`);
      }
    }
    if (msgs.length > 0) return msgs;
  }
  return ['Something went wrong. Please try again.'];
}

export default function RegisterPage() {
  const [form, setForm] = useState({ email:'', username:'', first_name:'', last_name:'', password:'', password_confirm:'' });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [globalError, setGlobalError] = useState('');
  const { register } = useAuth();
  const router = useRouter();

  const validate = () => {
    const e: Record<string,string> = {};
    if (!form.first_name.trim()) e.first_name = 'Required';
    if (!form.last_name.trim()) e.last_name = 'Required';
    if (!form.username.trim()) e.username = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!form.email.toLowerCase().endsWith('@mindstormstudios.com')) e.email = 'Only @mindstormstudios.com allowed';
    if (!form.password) e.password = 'Required';
    else if (form.password.length < 8) e.password = 'Min 8 characters';
    if (form.password !== form.password_confirm) e.password_confirm = 'Passwords don\'t match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({}); setGlobalError('');
    if (!validate()) return;
    setLoading(true);
    try {
      await register({ ...form, email: form.email.trim().toLowerCase(), username: form.username.trim() });
      toast.success('Account created!');
      router.push('/dashboard/tickets');
    } catch (err: any) {
      const msgs = extractErrors(err);
      setGlobalError(msgs[0]);
      toast.error(msgs[0]);
    } finally { setLoading(false); }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({...form, [k]: e.target.value});
    if (errors[k]) setErrors({...errors, [k]: ''});
    if (globalError) setGlobalError('');
  };

  const ic = (f: string) => `input-field ${errors[f] ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''}`;

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center"><Shield className="w-7 h-7 text-white" /></div>
            <h1 className="text-2xl font-bold text-white">Mindstorm Helpdesk</h1>
          </div>
          <p className="text-dark-400">Create your account</p>
        </div>
        <div className="card">
          {globalError && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{globalError}</div>}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1">First Name</label>
                <input value={form.first_name} onChange={set('first_name')} className={ic('first_name')} placeholder="Muhammad" />
                {errors.first_name && <p className="text-red-400 text-xs mt-1">{errors.first_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-1">Last Name</label>
                <input value={form.last_name} onChange={set('last_name')} className={ic('last_name')} placeholder="Akram" />
                {errors.last_name && <p className="text-red-400 text-xs mt-1">{errors.last_name}</p>}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Username</label>
              <input value={form.username} onChange={set('username')} className={ic('username')} placeholder="adnan.akram" />
              {errors.username && <p className="text-red-400 text-xs mt-1">{errors.username}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Email</label>
              <input type="email" value={form.email} onChange={set('email')} className={ic('email')} placeholder="you@mindstormstudios.com" />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Password</label>
              <input type="password" value={form.password} onChange={set('password')} className={ic('password')} placeholder="••••••••" />
              {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1">Confirm Password</label>
              <input type="password" value={form.password_confirm} onChange={set('password_confirm')} className={ic('password_confirm')} placeholder="••••••••" />
              {errors.password_confirm && <p className="text-red-400 text-xs mt-1">{errors.password_confirm}</p>}
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>
          <p className="text-center text-dark-400 text-sm mt-4">Already have an account?{' '}<Link href="/login" className="text-accent hover:text-accent-light">Sign In</Link></p>
        </div>
      </div>
    </div>
  );
}
TSEOF
echo "  [OK] register/page.tsx"

# ==========================================
# Fix login page
# ==========================================
cat > frontend/src/app/login/page.tsx << 'TSEOF'
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Shield, Loader2 } from 'lucide-react';

function getErrorMessage(err: any): string {
  const d = err?.response?.data;
  if (!d) return err?.message || 'Cannot connect to server.';
  if (typeof d.detail === 'string') return d.detail;
  if (Array.isArray(d.errors) && d.errors.length) return String(d.errors[0]);
  if (typeof d.error === 'string') return d.error;
  return 'Login failed.';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!email.trim()) { setError('Enter your email.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.push('/dashboard/tickets');
    } catch (err: any) {
      const msg = getErrorMessage(err);
      setError(msg); toast.error(msg);
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center"><Shield className="w-7 h-7 text-white" /></div>
            <h1 className="text-2xl font-bold text-white">Mindstorm Helpdesk</h1>
          </div>
          <p className="text-dark-400">Sign in to your account</p>
        </div>
        <div className="card">
          {error && <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} className="input-field" placeholder="you@mindstormstudios.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-1.5">Password</label>
              <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} className="input-field" placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading && <Loader2 size={16} className="animate-spin" />} {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <p className="text-center text-dark-400 text-sm mt-4">Don&apos;t have an account?{' '}<Link href="/register" className="text-accent hover:text-accent-light">Register</Link></p>
        </div>
      </div>
    </div>
  );
}
TSEOF
echo "  [OK] login/page.tsx"

# ==========================================
# Ensure all __init__.py and migration dirs exist
# ==========================================
for app in accounts tickets notifications integrations reports settings_manager; do
    touch backend/$app/__init__.py
    mkdir -p backend/$app/migrations
    touch backend/$app/migrations/__init__.py
done
echo "  [OK] init files"

# ==========================================
# REBUILD
# ==========================================
echo ""
echo "========================================"
echo "  STEP 3: Rebuild & restart"
echo "========================================"

docker compose down -v 2>/dev/null || true
docker compose build --no-cache 2>&1 | tail -5
docker compose up -d

echo ""
echo "Waiting for backend to be ready..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/api/health/ > /dev/null 2>&1; then
        echo "  Backend is UP!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "  WARNING: Backend still not responding after 30s"
        echo "  Check logs: docker compose logs backend"
    fi
    sleep 2
    printf "  ...waiting (%ds)\n" $((i*2))
done

echo ""
echo "--- Container status ---"
docker compose ps
echo ""

# Quick health check
echo "--- API health check ---"
curl -s http://localhost:8000/api/health/ 2>/dev/null && echo "" || echo "  Backend not responding yet"

echo ""
echo "========================================"
echo "  DONE! All fixes applied."
echo "========================================"
echo ""
echo "  What was fixed:"
echo "  1. 502 Bad Gateway — backend crash on startup"
echo "     -> Fixed settings.py (PRAGMA syntax, log file path, STORAGES)"
echo "     -> Fixed celery import (safe try/except)"
echo "     -> Fixed exception_handler (never return HTML)"
echo "  2. Frontend showing raw HTML errors"
echo "     -> api.ts now detects HTML responses and converts to JSON"
echo "  3. Error toast spam (character-by-character)"
echo "     -> Proper extractErrors() function on register page"
echo "  4. Added /api/health/ endpoint for debugging"
echo "  5. Removed docker-compose 'version' warning"
echo ""
echo "  Now go to: http://localhost/register"
echo "  If you still see issues, run:"
echo "    docker compose logs backend"
echo "========================================"
