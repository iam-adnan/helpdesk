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
