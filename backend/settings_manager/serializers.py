from rest_framework import serializers
from .models import AppSetting

class AppSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSetting
        fields = ['key','value','updated_at']

class SMTPSettingsSerializer(serializers.Serializer):
    smtp_host = serializers.CharField(required=True)
    smtp_port = serializers.IntegerField(default=587)
    smtp_user = serializers.CharField(required=False, default='', allow_blank=True)
    smtp_password = serializers.CharField(required=False, default='', allow_blank=True)
    smtp_from_email = serializers.EmailField(required=True)
    smtp_from_name = serializers.CharField(default='Mindstorm Helpdesk')

class GeneralSettingsSerializer(serializers.Serializer):
    app_name = serializers.CharField(default='Mindstorm Helpdesk')
    allowed_email_domain = serializers.CharField(default='mindstormstudios.com')
    support_teams = serializers.CharField(default='IT,HR,Finance,Engineering,Design')
