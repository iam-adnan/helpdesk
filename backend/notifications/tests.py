# backend/notifications/tests.py
from rest_framework.test import APITestCase
from rest_framework import status
from accounts.models import User
from .models import Notification


class NotificationViewSetTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='notifuser', email='notifuser@mindstormstudios.com', password='pw12345678')
        self.other = User.objects.create_user(username='notifother', email='notifother@mindstormstudios.com', password='pw12345678')
        self.n1 = Notification.objects.create(user=self.user, title='Ticket update', message='msg', channel='email')
        self.n2 = Notification.objects.create(user=self.other, title='Not yours', message='msg', channel='email')

    def test_user_only_sees_own_notifications(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get('/api/notifications/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        ids = {n['id'] for n in (resp.data['results'] if 'results' in resp.data else resp.data)}
        self.assertIn(str(self.n1.id), ids)
        self.assertNotIn(str(self.n2.id), ids)

    def test_mark_read(self):
        self.client.force_authenticate(self.user)
        resp = self.client.post(f'/api/notifications/{self.n1.id}/mark_read/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.n1.refresh_from_db()
        self.assertTrue(self.n1.read)

    def test_mark_all_read(self):
        Notification.objects.create(user=self.user, title='Second', message='msg', channel='email')
        self.client.force_authenticate(self.user)
        resp = self.client.post('/api/notifications/mark_all_read/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(Notification.objects.filter(user=self.user, read=False).count(), 0)

    def test_unread_count(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get('/api/notifications/unread_count/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['count'], 1)
