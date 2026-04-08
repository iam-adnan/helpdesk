from rest_framework.views import APIView
from rest_framework.response import Response
from accounts.permissions import IsAdmin
from settings_manager.models import AppSetting

class SlackSettingsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response({
            'bot_token': AppSetting.get('slack_bot_token', ''),
            'app_token': AppSetting.get('slack_app_token', ''),
            'channel_id': AppSetting.get('slack_channel_id', ''),
            'team_channel_id': AppSetting.get('slack_team_channel_id', ''),
            'configured': bool(AppSetting.get('slack_bot_token', '') and AppSetting.get('slack_app_token', '')),
        })

    def post(self, request):
        for key in ['slack_bot_token', 'slack_app_token', 'slack_channel_id', 'slack_team_channel_id', 'slack_signing_secret']:
            field = key.replace('slack_', '')
            val = request.data.get(field) or request.data.get(key)
            if val:
                AppSetting.set(key, val)
        return Response({'message': 'Saved! Run: docker compose restart slack-bot'})

class AISettingsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        return Response({
            'anthropic_api_key': '***' if AppSetting.get('anthropic_api_key', '') else '',
            'ai_enabled': AppSetting.get('ai_enabled', 'true') == 'true',
            'ai_model': AppSetting.get('ai_model', 'claude-sonnet-4-20250514'),
            'ai_system_prompt': AppSetting.get('ai_system_prompt', 'You are a helpful IT support assistant.'),
            'configured': bool(AppSetting.get('anthropic_api_key', '')),
        })

    def post(self, request):
        for key in ['anthropic_api_key', 'ai_enabled', 'ai_model', 'ai_system_prompt']:
            val = request.data.get(key)
            if val is not None:
                AppSetting.set(key, str(val))
        return Response({'message': 'AI settings saved.'})
