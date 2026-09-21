# backend/reports/tests.py
from rest_framework.test import APITestCase
from rest_framework import status
from accounts.models import User
from tickets.models import Ticket


class DashboardStatsViewTests(APITestCase):
    def setUp(self):
        self.agent = User.objects.create_user(username='ragent', email='ragent@mindstormstudios.com', password='pw12345678')
        self.agent.role = User.Role.AGENT
        self.agent.save()
        self.plain = User.objects.create_user(username='rplain', email='rplain@mindstormstudios.com', password='pw12345678')
        self.plain.role = User.Role.USER
        self.plain.save()
        Ticket.objects.create(subject='One', created_by=self.plain, status='open', priority='high')
        Ticket.objects.create(subject='Two', created_by=self.plain, status='resolved', priority='low')

    def test_plain_user_forbidden(self):
        self.client.force_authenticate(self.plain)
        resp = self.client.get('/api/reports/dashboard/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_agent_gets_stats_shape(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get('/api/reports/dashboard/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total_tickets'], 2)
        for key in ('status_breakdown', 'priority_breakdown', 'category_breakdown', 'daily_tickets', 'agent_performance'):
            self.assertIn(key, resp.data)
