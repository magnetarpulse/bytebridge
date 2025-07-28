from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance

class JWTAuthTest(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_12345'
        )
        
        self.token_url = reverse('token_obtain_pair')
        self.token_refresh_url = reverse('token_refresh')
        self.token_verify_url = reverse('token_verify')
        self.token_revoke_url = reverse('token_revoke')
        self.api_key_url = reverse('api_key_generate')
    
    def test_obtain_token(self):
        """Test obtaining JWT token"""
        data = {
            'username': 'testuser',
            'password': 'testpassword'
        }
        response = self.client.post(self.token_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertIn('bytebridge_instances', response.data)
        self.assertEqual(len(response.data['bytebridge_instances']), 1)
        self.assertEqual(response.data['bytebridge_instances'][0]['name'], 'Test Instance')
    
    def test_refresh_token(self):
        """Test refreshing JWT token"""
        # First obtain token
        data = {
            'username': 'testuser',
            'password': 'testpassword'
        }
        response = self.client.post(self.token_url, data)
        refresh_token = response.data['refresh']
        
        # Then refresh it
        data = {'refresh': refresh_token}
        response = self.client.post(self.token_refresh_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)
    
    def test_verify_token(self):
        """Test verifying JWT token"""
        # First obtain token
        data = {
            'username': 'testuser',
            'password': 'testpassword'
        }
        response = self.client.post(self.token_url, data)
        access_token = response.data['access']
        
        # Verify token
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
        response = self.client.get(self.token_verify_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['username'], 'testuser')
        self.assertIn('bytebridge_instances', response.data)
    
    def test_generate_api_key(self):
        """Test generating API key for CLI"""
        # First obtain token
        data = {
            'username': 'testuser',
            'password': 'testpassword'
        }
        response = self.client.post(self.token_url, data)
        access_token = response.data['access']
        
        # Generate API key
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
        response = self.client.post(self.api_key_url)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)
        self.assertEqual(response.data['token_type'], 'bytebridge_api_key')