from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.permissions import IsAdmin
from .models import AppSetting
from .serializers import SMTPSettingsSerializer, GeneralSettingsSerializer

class SMTPSettingsView(APIView):
    permission_classes = [IsAdmin]
    def get(self, request):
        return Response({
            'smtp_host': AppSetting.get('smtp_host', ''),
            'smtp_port': int(AppSetting.get('smtp_port', '587')),
            'smtp_user': AppSetting.get('smtp_user', ''),
            'smtp_password': '***' if AppSetting.get('smtp_password', '') else '',
            'smtp_from_email': AppSetting.get('smtp_from_email', ''),
            'smtp_from_name': AppSetting.get('smtp_from_name', 'Mindstorm Helpdesk'),
        })
    def post(self, request):
        ser = SMTPSettingsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        for key, val in ser.validated_data.items():
            AppSetting.set(key, str(val))
        return Response({'message': 'SMTP settings saved.'})

class GeneralSettingsView(APIView):
    permission_classes = [IsAdmin]
    def get(self, request):
        return Response({
            'app_name': AppSetting.get('app_name', 'Mindstorm Helpdesk'),
            'allowed_email_domain': AppSetting.get('allowed_email_domain', 'mindstormstudios.com'),
            'support_teams': AppSetting.get('support_teams', 'IT,HR,Finance,Engineering,Design'),
        })
    def post(self, request):
        ser = GeneralSettingsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        for key, val in ser.validated_data.items():
            AppSetting.set(key, str(val))
        return Response({'message': 'Settings saved.'})
