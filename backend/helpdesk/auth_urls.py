from django.urls import path
from django.contrib.auth import logout as auth_logout
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.conf import settings


def login_user(email, password):
    """Authenticate by email directly."""
    from helpdesk.models import User
    try:
        user = User.objects.get(email=email)
        if user.check_password(password) and user.is_active:
            return user
        return None
    except User.DoesNotExist:
        return None


@ensure_csrf_cookie
@api_view(['GET'])
@permission_classes([AllowAny])
def auth_status(request):
    if request.user.is_authenticated:
        from helpdesk.serializers import UserSerializer
        request.user.last_login_at = timezone.now()
        request.user.save(update_fields=['last_login_at'])
        return JsonResponse({'authenticated': True, 'user': UserSerializer(request.user).data})
    return JsonResponse({'authenticated': False})


@api_view(['POST'])
@permission_classes([AllowAny])
def auth_login_view(request):
    email = request.data.get('email', '').strip().lower()
    password = request.data.get('password', '')

    if not email or not password:
        return Response({'error': 'Email and password are required.'}, status=400)

    allowed_domain = getattr(settings, 'ALLOWED_EMAIL_DOMAIN', 'mindstormstudios.com')
    if not email.endswith(f'@{allowed_domain}'):
        return Response({'error': f'Only @{allowed_domain} accounts are allowed.'}, status=403)

    user = login_user(email, password)
    if user is None:
        return Response({'error': 'Invalid email or password.'}, status=401)

    from django.contrib.auth import login as auth_login
    auth_login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    user.last_login_at = timezone.now()
    user.save(update_fields=['last_login_at'])

    from helpdesk.serializers import UserSerializer
    return Response({'authenticated': True, 'user': UserSerializer(user).data})


@api_view(['POST'])
@permission_classes([AllowAny])
def auth_register_view(request):
    email = request.data.get('email', '').strip().lower()
    password = request.data.get('password', '')
    name = request.data.get('name', '').strip()

    if not email or not password or not name:
        return Response({'error': 'Name, email and password are required.'}, status=400)

    allowed_domain = getattr(settings, 'ALLOWED_EMAIL_DOMAIN', 'mindstormstudios.com')
    if not email.endswith(f'@{allowed_domain}'):
        return Response({'error': f'Only @{allowed_domain} accounts are allowed.'}, status=403)

    if len(password) < 8:
        return Response({'error': 'Password must be at least 8 characters.'}, status=400)

    from helpdesk.models import User
    if User.objects.filter(email=email).exists():
        return Response({'error': 'An account with this email already exists.'}, status=400)

    parts = name.strip().split(' ', 1)
    username = email.split('@')[0].replace('.', '_')
    # Ensure username is unique
    base_username = username
    counter = 1
    while User.objects.filter(username=username).exists():
        username = f'{base_username}_{counter}'
        counter += 1

    role = 'admin' if User.objects.count() == 0 else 'user'

    user = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        first_name=parts[0],
        last_name=parts[1] if len(parts) > 1 else '',
        role=role,
        is_staff=(role == 'admin'),
        is_superuser=(role == 'admin'),
    )

    from django.contrib.auth import login as auth_login
    auth_login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    user.last_login_at = timezone.now()
    user.save(update_fields=['last_login_at'])

    from helpdesk.serializers import UserSerializer
    return Response({'authenticated': True, 'user': UserSerializer(user).data}, status=201)


@api_view(['POST', 'GET'])
@permission_classes([AllowAny])
def auth_logout_view(request):
    auth_logout(request)
    return Response({'authenticated': False})


urlpatterns = [
    path('status/', auth_status),
    path('login/', auth_login_view),
    path('register/', auth_register_view),
    path('logout/', auth_logout_view),
]
