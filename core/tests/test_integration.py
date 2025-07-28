from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile

class APIIntegrationTest(APITestCase):
    def setUp(self):
        # Create test user
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        
        # Set up API client
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
    
    def test_complete_resource_hierarchy(self):
        """Test creating and managing a complete resource hierarchy"""
        # 1. Create a ByteBridge instance
        instance_data = {
            'name': 'Integration Test Instance',
            'api_token': 'integration_token_12345'
        }
        response = self.client.post(reverse('instance-list'), instance_data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        instance_id = response.data['id']
        
        # Verify instance was created
        response = self.client.get(reverse('instance-detail', args=[instance_id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Integration Test Instance')
        
        # 2. Create a DataStore in the instance
        datastore_data = {
            'name': 'Integration Test DataStore',
            'instance': instance_id,
            'permission_type': 'private',
            'description': 'Created during integration test'
        }
        response = self.client.post(reverse('datastore-list'), datastore_data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        datastore_id = response.data['id']
        
        # Verify datastore was created
        response = self.client.get(reverse('datastore-detail', args=[datastore_id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Integration Test DataStore')
        
        # 3. Create a Bucket in the datastore
        bucket_data = {
            'name': 'Integration Test Bucket',
            'datastore': datastore_id,
            'is_collection': True
        }
        response = self.client.post(reverse('bucket-list'), bucket_data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        bucket_id = response.data['id']
        
        # Verify bucket was created
        response = self.client.get(reverse('bucket-detail', args=[bucket_id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Integration Test Bucket')
        
        # 4. Upload a file to the bucket
        temp_file = SimpleUploadedFile(
            "integration_test.txt",
            b"This is an integration test file.",
            content_type="text/plain"
        )
        
        object_data = {
            'name': 'Integration Test File',
            'bucket': bucket_id,
            'file': temp_file,
            'content_type': 'text/plain',
            'size': len(b"This is an integration test file.")
        }
        response = self.client.post(reverse('object-list'), object_data, format='multipart')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        object_id = response.data['id']
        
        # Verify object was created
        response = self.client.get(reverse('object-detail', args=[object_id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Integration Test File')
        
        # 5. Change permissions on the datastore to public
        datastore_update = {
            'permission_type': 'public'
        }
        response = self.client.patch(reverse('datastore-detail', args=[datastore_id]), datastore_update)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Verify permission change
        response = self.client.get(reverse('datastore-detail', args=[datastore_id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['permission_type'], 'public')
        
        # 6. Create a second user and verify permissions
        second_user = User.objects.create_user(
            username='seconduser',
            password='secondpassword'
        )
        
        second_client = APIClient()
        second_client.force_authenticate(user=second_user)
        
        # Second user should be able to see the public datastore
        response = second_client.get(reverse('datastore-detail', args=[datastore_id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # But should not be able to modify it
        datastore_update = {
            'name': 'Hacked DataStore'
        }
        response = second_client.patch(reverse('datastore-detail', args=[datastore_id]), datastore_update)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        
        # 7. Clean up - delete the object, bucket, datastore and instance
        response = self.client.delete(reverse('object-detail', args=[object_id]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        
        response = self.client.delete(reverse('bucket-detail', args=[bucket_id]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        
        response = self.client.delete(reverse('datastore-detail', args=[datastore_id]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        
        response = self.client.delete(reverse('instance-detail', args=[instance_id]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        
        # Verify everything was deleted
        response = self.client.get(reverse('instance-detail', args=[instance_id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)