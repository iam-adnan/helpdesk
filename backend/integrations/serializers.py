from rest_framework import serializers

class SlackSettingsSerializer(serializers.Serializer):
    bot_token = serializers.CharField(required=True)
    signing_secret = serializers.CharField(required=True)
    channel_id = serializers.CharField(required=False, default='')

class AISettingsSerializer(serializers.Serializer):
    anthropic_api_key = serializers.CharField(required=False, allow_blank=True)
    ai_enabled = serializers.BooleanField(default=True)
    ai_model = serializers.CharField(default='claude-sonnet-4-20250514')
    ai_system_prompt = serializers.CharField(required=False, default='You are a helpful IT support assistant for Mindstorm Studios. Provide brief, helpful first responses to support tickets. Be professional and concise.', allow_blank=True)
