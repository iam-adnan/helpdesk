# backend/tickets/tests.py
from django.test import TestCase
from rest_framework.test import APITestCase
from rest_framework import status
from accounts.models import User
from .models import Ticket


class TicketModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='reporter', email='reporter@mindstormstudios.com', password='pw12345678')

    def test_ticket_number_auto_increments(self):
        t1 = Ticket.objects.create(subject='First issue', created_by=self.user)
        t2 = Ticket.objects.create(subject='Second issue', created_by=self.user)
        self.assertEqual(t1.ticket_number, 'MS-00001')
        self.assertEqual(t2.ticket_number, 'MS-00002')

    def test_default_status_and_priority(self):
        t = Ticket.objects.create(subject='Defaults check', created_by=self.user)
        self.assertEqual(t.status, Ticket.Status.OPEN)
        self.assertEqual(t.priority, Ticket.Priority.MEDIUM)


class TicketViewSetTests(APITestCase):
    def setUp(self):
        # First user created anywhere in the suite becomes admin (see accounts.User.save);
        # to keep this file independent of test ordering, create+fix roles explicitly.
        self.admin = User.objects.create_user(username='tadmin', email='tadmin@mindstormstudios.com', password='pw12345678')
        self.admin.role = User.Role.ADMIN
        self.admin.is_staff = True
        self.admin.save()

        self.agent = User.objects.create_user(username='tagent', email='tagent@mindstormstudios.com', password='pw12345678')
        self.agent.role = User.Role.AGENT
        self.agent.save()

        self.owner = User.objects.create_user(username='towner', email='towner@mindstormstudios.com', password='pw12345678')
        self.owner.role = User.Role.USER
        self.owner.save()

        self.other = User.objects.create_user(username='tother', email='tother@mindstormstudios.com', password='pw12345678')
        self.other.role = User.Role.USER
        self.other.save()

        self.owner_ticket = Ticket.objects.create(subject='Owner ticket', created_by=self.owner)
        self.other_ticket = Ticket.objects.create(subject='Other ticket', created_by=self.other)

    def test_plain_user_sees_only_own_tickets(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.get('/api/tickets/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {t['id'] for t in resp.data['results']} if 'results' in resp.data else {t['id'] for t in resp.data}
        self.assertIn(str(self.owner_ticket.id), ids)
        self.assertNotIn(str(self.other_ticket.id), ids)

    def test_agent_sees_all_tickets(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get('/api/tickets/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        count = resp.data['count'] if 'count' in resp.data else len(resp.data)
        self.assertEqual(count, 2)

    def test_create_ticket_sets_created_by_and_logs_activity(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post('/api/tickets/', {'subject': 'New problem', 'priority': 'high', 'category': 'problem'})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        # TicketCreateSerializer's fields (see tickets/serializers.py) are write-only
        # input fields and do not include 'id', so the create response has no 'id' key.
        # Look the ticket up by its distinguishing attributes instead.
        ticket = Ticket.objects.get(created_by=self.owner, subject='New problem')
        self.assertEqual(ticket.created_by, self.owner)
        self.assertEqual(ticket.activities.filter(action='created').count(), 1)

    def test_comment_action_requires_content(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/comment/', {'content': ''})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_comment_action_creates_comment(self):
        self.client.force_authenticate(self.owner)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/comment/', {'content': 'Any update?'})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.owner_ticket.comments.count(), 1)

    def test_assign_action_moves_open_to_in_progress(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/assign/', {'agent_id': str(self.agent.id)})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.owner_ticket.refresh_from_db()
        self.assertEqual(self.owner_ticket.assigned_to, self.agent)
        self.assertEqual(self.owner_ticket.status, 'in_progress')

    def test_assign_action_unknown_agent(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.post(f'/api/tickets/{self.owner_ticket.id}/assign/', {'agent_id': '00000000-0000-0000-0000-000000000000'})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_stats_action_counts_by_status(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.get('/api/tickets/stats/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['total'], 2)
        self.assertEqual(resp.data['open'], 2)

    def test_update_to_resolved_sets_resolved_at(self):
        self.client.force_authenticate(self.agent)
        resp = self.client.patch(f'/api/tickets/{self.owner_ticket.id}/', {'status': 'resolved'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.owner_ticket.refresh_from_db()
        self.assertIsNotNone(self.owner_ticket.resolved_at)

    def test_anonymous_cannot_access_tickets(self):
        resp = self.client.get('/api/tickets/')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
