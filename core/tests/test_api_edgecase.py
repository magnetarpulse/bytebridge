from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance, DataStore, Bucket, Object
from django.core.files.uploadedfile import SimpleUploadedFile
import uuid

class APIEdgeCaseTest(APITestCase):
    def setUp(self):
        # Create test users
        self.owner = User.objects.create_user(
            username='owner',
            password='ownerpassword'
        )
        self.other_user = User.objects.create_user(
            username='otheruser',
            password='otheruserpassword'
        )
        
        # Set up API client
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        
        # Create a ByteBridge instance
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.owner,
            api_token='test_token_12345'
        )
        
        # Create datastores with different permissions
        self.private_datastore = DataStore.objects.create(
            name='Private DataStore',
            instance=self.instance,
            owner=self.owner,
            permission_type='private'
        )
        
        self.public_datastore = DataStore.objects.create(
            name='Public DataStore',
            instance=self.instance,
            owner=self.owner,
            permission_type='public'
        )
        
        self.community_datastore = DataStore.objects.create(
            name='Community DataStore',
            instance=self.instance,
            owner=self.owner,
            permission_type='community'
        )
    
    def test_creating_instance_with_existing_token(self):
        """Test that API rejects creating a new instance with an existing token"""
        data = {
            'name': 'Duplicate Token Instance',
            'api_token': 'test_token_12345'  # Already exists
        }
        response = self.client.post(reverse('instance-list'), data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('api_token', response.data)
    
    def test_instance_not_found(self):
        """Test handling when trying to access non-existent ByteBridge instance"""
        # Use a random UUID that's guaranteed not to exist
        non_existent_id = uuid.uuid4()
        response = self.client.get(reverse('instance-detail', args=[non_existent_id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
    
    def test_datastore_with_invalid_permission_type(self):
        """Test that API rejects invalid permission types"""
        data = {
            'name': 'Invalid Permission DataStore',
            'instance': self.instance.id,
            'permission_type': 'invalid_type'  # Not a valid choice
        }
        response = self.client.post(reverse('datastore-list'), data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('permission_type', response.data)
    
    def test_permission_inheritance(self):
        """Test that buckets properly inherit permissions from datastores"""
        # Create a bucket with no explicit permission_type
        bucket = Bucket.objects.create(
            name='Inherited Permission Bucket',
            datastore=self.public_datastore,
            owner=self.owner
        )
        
        # Verify that the effective permission is inherited from datastore
        self.assertEqual(bucket.get_effective_permission(), 'public')
        
        # Now override with explicit permission
        bucket.permission_type = 'private'
        bucket.save()
        
        # Verify the override works
        self.assertEqual(bucket.get_effective_permission(), 'private')
        
        # Switch to other user and verify access
        self.client.force_authenticate(user=self.other_user)
        
        # Should not be able to access the bucket now that it's private
        response = self.client.get(reverse('bucket-detail', args=[bucket.id]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
    
    def test_permission_changes_affect_access(self):
        """Test that changing permissions affects access immediately"""
        # Create a private bucket
        bucket = Bucket.objects.create(
            name='Private Bucket',
            datastore=self.private_datastore,
            owner=self.owner,
            permission_type='private'
        )
        
        # Switch to other user
        self.client.force_authenticate(user=self.other_user)
        
        # Should not be able to access the bucket
        response = self.client.get(reverse('bucket-detail', args=[bucket.id]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        
        # Switch back to owner and change permission to public
        self.client.force_authenticate(user=self.owner)
        data = {'permission_type': 'public'}
        response = self.client.patch(reverse('bucket-detail', args=[bucket.id]), data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Switch to other user again
        self.client.force_authenticate(user=self.other_user)
        
        # Should now be able to access the bucket
        response = self.client.get(reverse('bucket-detail', args=[bucket.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Private Bucket')
        
        # But should not be able to modify it
        data = {'name': 'Hacked Bucket'}
        response = self.client.patch(reverse('bucket-detail', args=[bucket.id]), data)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
    
    def test_cascading_permissions(self):
        """Test that objects inherit permissions through the hierarchy"""
        # Create a private bucket
        bucket = Bucket.objects.create(
            name='Private Bucket',
            datastore=self.private_datastore,
            owner=self.owner
        )
        
        # Create an object in the bucket
        temp_file = SimpleUploadedFile(
            "test_file.txt",
            b"Test content",
            content_type="text/plain"
        )
        
        obj = Object.objects.create(
            name='Private Object',
            bucket=bucket,
            file=temp_file,
            content_type='text/plain',
            size=len(b"Test content")
        )
        
        # Switch to other user
        self.client.force_authenticate(user=self.other_user)
        
        # Should not be able to access the object
        response = self.client.get(reverse('object-detail', args=[obj.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        
        # Switch back to owner and change bucket permission to public
        self.client.force_authenticate(user=self.owner)
        bucket.permission_type = 'public'
        bucket.save()
        
        # Switch to other user again
        self.client.force_authenticate(user=self.other_user)
        
        # Should now be able to access the object
        response = self.client.get(reverse('object-detail', args=[obj.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Private Object')