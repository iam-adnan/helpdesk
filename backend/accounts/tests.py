# backend/accounts/tests.py
from django.test import TestCase
from rest_framework.test import APITestCase
from rest_framework import status
from .models import User


class UserModelTests(TestCase):
    def test_first_user_becomes_admin(self):
        user = User.objects.create_user(
            username='first', email='first@mindstormstudios.com', password='pw12345678'
        )
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)

    def test_second_user_is_not_admin(self):
        User.objects.create_user(username='first', email='first@mindstormstudios.com', password='pw12345678')
        second = User.objects.create_user(username='second', email='second@mindstormstudios.com', password='pw12345678')
        self.assertEqual(second.role, User.Role.USER)
        self.assertFalse(second.is_staff)

    def test_email_is_lowercased_on_save(self):
        user = User.objects.create_user(username='mixed', email='MiXeD@MindstormStudios.com', password='pw12345678')
        self.assertEqual(user.email, 'mixed@mindstormstudios.com')

    def test_username_auto_dedup(self):
        User.objects.create_user(username='dupe', email='dupe@mindstormstudios.com', password='pw12345678')
        second = User(email='dupe2@mindstormstudios.com')
        second.username = ''
        second.set_password('pw12345678')
        second.save()
        # falls back to email-local-part-based generation since username was blank
        self.assertTrue(second.username)

    def test_is_agent_true_for_admin_and_agent(self):
        admin = User(role=User.Role.ADMIN)
        agent = User(role=User.Role.AGENT)
        plain = User(role=User.Role.USER)
        self.assertTrue(admin.is_agent)
        self.assertTrue(agent.is_agent)
        self.assertFalse(plain.is_agent)


class RegisterViewTests(APITestCase):
    def test_register_rejects_wrong_domain(self):
        resp = self.client.post('/api/auth/register/', {
            'email': 'someone@gmail.com', 'username': 'someone',
            'password': 'pw12345678', 'password_confirm': 'pw12345678',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_allows_allowed_domain_and_returns_tokens(self):
        resp = self.client.post('/api/auth/register/', {
            'email': 'newagent@mindstormstudios.com', 'username': 'newagent',
            'password': 'pw12345678', 'password_confirm': 'pw12345678',
        })
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn('tokens', resp.data)
        self.assertIn('access', resp.data['tokens'])

    def test_register_rejects_mismatched_passwords(self):
        resp = self.client.post('/api/auth/register/', {
            'email': 'mismatch@mindstormstudios.com', 'username': 'mismatch',
            'password': 'pw12345678', 'password_confirm': 'different',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_register_rejects_duplicate_email(self):
        User.objects.create_user(username='existing', email='existing@mindstormstudios.com', password='pw12345678')
        resp = self.client.post('/api/auth/register/', {
            'email': 'existing@mindstormstudios.com', 'username': 'existing2',
            'password': 'pw12345678', 'password_confirm': 'pw12345678',
        })
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class LoginViewTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='loginuser', email='loginuser@mindstormstudios.com', password='correct-pw123'
        )

    def test_login_success(self):
        resp = self.client.post('/api/auth/login/', {'email': 'loginuser@mindstormstudios.com', 'password': 'correct-pw123'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp.data['tokens'])

    def test_login_wrong_password(self):
        resp = self.client.post('/api/auth/login/', {'email': 'loginuser@mindstormstudios.com', 'password': 'wrong'})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_unknown_email(self):
        resp = self.client.post('/api/auth/login/', {'email': 'nobody@mindstormstudios.com', 'password': 'whatever123'})
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_disabled_account(self):
        self.user.is_active = False
        self.user.save()
        resp = self.client.post('/api/auth/login/', {'email': 'loginuser@mindstormstudios.com', 'password': 'correct-pw123'})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class AdminUserViewSetPermissionTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin1', email='admin1@mindstormstudios.com', password='pw12345678')
        self.plain = User.objects.create_user(username='plain1', email='plain1@mindstormstudios.com', password='pw12345678')
        # admin1 is the FIRST user, so it's auto-admin; make plain1 explicitly non-admin to be sure
        self.plain.role = User.Role.USER
        self.plain.is_staff = False
        self.plain.save()

    def test_non_admin_cannot_list_users(self):
        self.client.force_authenticate(self.plain)
        resp = self.client.get('/api/auth/admin/users/')
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_list_users(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get('/api/auth/admin/users/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_admin_set_role(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/auth/admin/users/{self.plain.id}/set_role/', {'role': 'agent'})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.plain.refresh_from_db()
        self.assertEqual(self.plain.role, 'agent')

    def test_admin_set_invalid_role_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/auth/admin/users/{self.plain.id}/set_role/', {'role': 'superhero'})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
