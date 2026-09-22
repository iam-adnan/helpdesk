# backend/settings_manager/tests.py
from django.test import TestCase
from .models import AppSetting


class AppSettingTests(TestCase):
    def test_get_returns_default_when_missing(self):
        self.assertEqual(AppSetting.get('does_not_exist', 'fallback'), 'fallback')

    def test_set_then_get_roundtrip(self):
        AppSetting.set('slack_bot_token', 'xoxb-test-token')
        self.assertEqual(AppSetting.get('slack_bot_token'), 'xoxb-test-token')

    def test_set_is_upsert(self):
        AppSetting.set('ai_enabled', 'true')
        AppSetting.set('ai_enabled', 'false')
        self.assertEqual(AppSetting.get('ai_enabled'), 'false')
        self.assertEqual(AppSetting.objects.filter(key='ai_enabled').count(), 1)
