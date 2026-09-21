# backend/integrations/tests.py
from django.test import TestCase
from .models import SlackInstallation


class SlackInstallationModelTests(TestCase):
    def test_str_returns_team_name(self):
        install = SlackInstallation.objects.create(
            team_id='T12345', team_name='Mindstorm Studios',
            bot_token='xoxb-fake', channel_id='C123', channel_name='helpdesk',
        )
        self.assertEqual(str(install), 'Mindstorm Studios')

    def test_team_id_is_unique(self):
        SlackInstallation.objects.create(team_id='T999', team_name='A', bot_token='x')
        with self.assertRaises(Exception):
            SlackInstallation.objects.create(team_id='T999', team_name='B', bot_token='y')
