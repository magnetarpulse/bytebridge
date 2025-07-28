from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance, DataStore

class APIErrorHandlingTest(APITestCase):
    def setUp(self):
        # Create test user
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        
        # Set up API client
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        
        # Create a ByteBridge instance
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_12345'
        )
        
        # Create a datastore
        self.datastore = DataStore.objects.create(
            name='Test DataStore',
            instance=self.instance,
            owner=self.user,
            permission_type='private'
        )

    def test_jwt_authentication_works(self):
        """Test that JWT authentication works correctly"""
        from rest_framework_simplejwt.tokens import RefreshToken
        
        # Create a new client without auth
        client = APIClient()
        
        # Verify endpoint requires authentication
        response = client.get(reverse('instance-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        
        # Generate valid token
        refresh = RefreshToken.for_user(self.user)
        access_token = str(refresh.access_token)
        
        # Use token
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')
        response = client.get(reverse('instance-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
    
    def test_missing_required_fields(self):
        """Test API response when required fields are missing"""
        # Try to create a datastore without a name
        data = {
            'instance': self.instance.id,
            'permission_type': 'private'
            # Missing 'name' field
        }
        response = self.client.post(reverse('datastore-list'), data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)
    
    def test_invalid_foreign_key(self):
        """Test API response when using an invalid foreign key"""
        # Try to create a datastore with a non-existent instance ID
        data = {
            'name': 'Invalid Instance DataStore',
            'instance': 999999,  # Non-existent ID
            'permission_type': 'private'
        }
        response = self.client.post(reverse('datastore-list'), data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('instance', response.data)
    
    def test_invalid_input_types(self):
        """Test API response with invalid input types"""
        # Try to create a bucket with invalid types
        data = {
            'name': 12345,                    # Not a string
            'datastore': 'not-an-id',         # Not an integer
            'is_collection': 'not-a-boolean'  # Not a boolean
        }
        response = self.client.post(reverse('bucket-list'), data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Django REST may convert some types, check which errors appear
        self.assertTrue('datastore' in response.data or 'is_collection' in response.data)
    
    def test_malformed_jwt_token(self):
        """Test handling of malformed JWT tokens"""
        # Create a new client without authentication
        client = APIClient()
        
        # Set a malformed token
        client.credentials(HTTP_AUTHORIZATION='Bearer malformed.jwt.token')
        
        # Try to access protected resource
        response = client.get(reverse('instance-list'))
        
        # Should get 401 unauthorized
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
    
    def test_isolated_jwt_expiration(self):
        """Test JWT token expiration in isolation"""
        from rest_framework_simplejwt.tokens import AccessToken
        from rest_framework_simplejwt.settings import api_settings
        from datetime import timedelta
        import time
        
        # Create a token with explicit expiration
        token = AccessToken()
        token.payload['exp'] = time.time()  # Set to expire now
        token.payload['user_id'] = self.user.id
        
        # Create a new client
        client = APIClient()
        
        # Use expired token
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        response = client.get(reverse('instance-list'))
        
        # Should be unauthorized
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
    
    def test_expired_jwt_token(self):
        """Test handling of expired JWT tokens"""
        import jwt
        from django.conf import settings
        from rest_framework_simplejwt.settings import api_settings
        import time
        
        # Save original authentication classes
        from api.viewsets import ByteBridgeInstanceViewSet
        original_auth = ByteBridgeInstanceViewSet.authentication_classes
        
        try:
            # Force JWT-only authentication for this test
            from rest_framework_simplejwt.authentication import JWTAuthentication
            ByteBridgeInstanceViewSet.authentication_classes = [JWTAuthentication]
            
            # Create an explicitly expired token using PyJWT directly
            payload = {
                'user_id': self.user.id,
                'exp': int(time.time()) - 30,  # 30 seconds in the past
                'token_type': 'access',
                'jti': 'test-jti'
            }
            
            # Generate the token with the same key Django uses
            token = jwt.encode(
                payload, 
                settings.SECRET_KEY,
                algorithm='HS256'
            )
            
            # Create a fresh client without any session auth
            client = APIClient()
            
            # Use the expired token
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            response = client.get(reverse('instance-list'))
            
            # This should fail with 401 Unauthorized
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        
        finally:
            # Restore original authentication classes
            ByteBridgeInstanceViewSet.authentication_classes = original_auth
    
    def test_naturally_expired_jwt_token(self):
        """Test that a naturally expired JWT token is rejected"""
        import time
        import jwt
        from django.conf import settings
        
        # Save original authentication classes for ALL viewsets that need to be tested
        from api.viewsets import (
            ByteBridgeInstanceViewSet, DataStoreViewSet,
            BucketViewSet, ObjectViewSet
        )
        original_auth_instance = ByteBridgeInstanceViewSet.authentication_classes
        original_auth_datastore = DataStoreViewSet.authentication_classes
        original_auth_bucket = BucketViewSet.authentication_classes
        original_auth_object = ObjectViewSet.authentication_classes
        
        try:
            # Force JWT-only authentication for ALL viewsets
            from rest_framework_simplejwt.authentication import JWTAuthentication
            ByteBridgeInstanceViewSet.authentication_classes = [JWTAuthentication]
            DataStoreViewSet.authentication_classes = [JWTAuthentication]
            BucketViewSet.authentication_classes = [JWTAuthentication]
            ObjectViewSet.authentication_classes = [JWTAuthentication]
            
            # Create a JWT token with a short expiration time (1 second)
            # Using PyJWT directly for precise control over token properties
            exp_time = int(time.time()) + 1  # Current time + 1 second
            
            payload = {
                'user_id': self.user.id,
                'exp': exp_time,
                'token_type': 'access',
                'jti': 'test-jti'
            }
            
            # Generate token
            token = jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')
            
            # Create a client and keep using the SAME one
            client = APIClient()
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            
            # First verify the token works
            response = client.get(reverse('instance-list'))
            self.assertEqual(response.status_code, status.HTTP_200_OK, 
                             "Token should be valid initially")
            
            # Now wait for the token to expire
            # Sleep for 2 seconds to ensure the token is expired
            time.sleep(2)  
            
            # Try again with the now-expired token using the SAME client
            # This tests what happens to existing sessions when their token expires
            response = client.get(reverse('instance-list'))
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, 
                             "Token should be rejected after expiration (same client)")
            
            # Also test with a fresh client to ensure the token is invalidated
            fresh_client = APIClient()
            fresh_client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            response = fresh_client.get(reverse('instance-list'))
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, 
                             "Token should be rejected after expiration (new client)")
            
        finally:
            # Restore original authentication classes
            ByteBridgeInstanceViewSet.authentication_classes = original_auth_instance
            DataStoreViewSet.authentication_classes = original_auth_datastore
            BucketViewSet.authentication_classes = original_auth_bucket
            ObjectViewSet.authentication_classes = original_auth_object

    def test_naturally_expired_jwt_token_realistic(self):
        """
        Test that an expired JWT token is rejected even with multiple authentication methods enabled.
        This is a more realistic production scenario where we don't force JWT-only authentication.
        """
        import time
        import jwt
        from django.conf import settings
        
        # Create a JWT token with a short expiration time (1 second)
        # Using PyJWT directly for precise control over token properties
        exp_time = int(time.time()) + 1  # Current time + 1 second
        
        payload = {
            'user_id': self.user.id,
            'exp': exp_time,
            'token_type': 'access',
            'jti': 'test-jti'
        }
        
        # Generate token
        token = jwt.encode(payload, settings.SECRET_KEY, algorithm='HS256')
        
        # Create a client and keep using the SAME one
        client = APIClient()
        
        # First ensure no authentication works without credentials
        response = client.get(reverse('instance-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, 
                         "Unauthenticated request should be rejected")
        
        # Now authenticate with the JWT token
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        
        # Verify the token works initially
        response = client.get(reverse('instance-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK, 
                         "Token should be valid initially")
        
        # Wait for the token to expire
        # Sleep for 2 seconds to ensure the token is expired
        time.sleep(2)  
        
        # Try again with the now-expired token using the SAME client
        # This tests what happens to existing sessions when their token expires
        # WITH ALL DEFAULT AUTHENTICATION METHODS ENABLED
        response = client.get(reverse('instance-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, 
                         "Token should be rejected after expiration even with multiple auth methods")
        
        # Try different API endpoints to ensure they also reject the expired token
        response = client.get(reverse('datastore-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, 
                         "Datastore endpoint should reject expired token")
        
        # Test with explicitly setting ONLY the expired JWT token (no session auth)
        headers = {'HTTP_AUTHORIZATION': f'Bearer {token}'}
        response = client.get(reverse('instance-list'), **headers)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, 
                         "Explicit use of expired token should be rejected")
        
        # Test if we can still authenticate with session after JWT expires
        # First, try to get a new session cookie while using expired JWT
        response = client.post(
            reverse('token_obtain_pair'), 
            {'username': 'testuser', 'password': 'wrongpassword'},
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED, 
                         "Should not be able to get new session with expired JWT")