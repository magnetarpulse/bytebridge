from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance, DataStore, Bucket, Object
from django.core.files.uploadedfile import SimpleUploadedFile

class PermissionTest(APITestCase):
    def setUp(self):
        # Create owner user
        self.owner = User.objects.create_user(
            username='owner',
            password='ownerpassword'
        )
        
        # Create another user
        self.other_user = User.objects.create_user(
            username='otheruser',
            password='otheruserpassword'
        )
        
        # Create ByteBridge instance
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.owner,
            api_token='test_token_12345'
        )
        
        # Create private datastore
        self.private_datastore = DataStore.objects.create(
            name='Private DataStore',
            instance=self.instance,
            owner=self.owner,
            permission_type='private',
        )
        
        # Create public datastore
        self.public_datastore = DataStore.objects.create(
            name='Public DataStore',
            instance=self.instance,
            owner=self.owner,
            permission_type='public',
        )
        
        # Create community datastore
        self.community_datastore = DataStore.objects.create(
            name='Community DataStore',
            instance=self.instance,
            owner=self.owner,
            permission_type='community',
        )
        
        # Create buckets in each datastore
        self.private_bucket = Bucket.objects.create(
            name='Private Bucket',
            datastore=self.private_datastore,
            owner=self.owner,
        )
        
        self.public_bucket = Bucket.objects.create(
            name='Public Bucket',
            datastore=self.public_datastore,
            owner=self.owner,
        )
        
        self.community_bucket = Bucket.objects.create(
            name='Community Bucket',
            datastore=self.community_datastore,
            owner=self.owner,
        )
        
        # Create test file
        temp_file = SimpleUploadedFile(
            "test_file.txt",
            b"Test content",
            content_type="text/plain"
        )
        
        # Create objects in buckets
        self.private_object = Object.objects.create(
            name='Private Object',
            bucket=self.private_bucket,
            file=temp_file,
            content_type='text/plain',
            size=len(b"Test content")
        )
        
        temp_file = SimpleUploadedFile(
            "public_file.txt",
            b"Public content",
            content_type="text/plain"
        )
        
        self.public_object = Object.objects.create(
            name='Public Object',
            bucket=self.public_bucket,
            file=temp_file,
            content_type='text/plain',
            size=len(b"Public content")
        )
        
        temp_file = SimpleUploadedFile(
            "community_file.txt",
            b"Community content",
            content_type="text/plain"
        )
        
        self.community_object = Object.objects.create(
            name='Community Object',
            bucket=self.community_bucket,
            file=temp_file,
            content_type='text/plain',
            size=len(b"Community content")
        )
        
        # Initialize client
        self.client = APIClient()
    
    def test_bytebridge_instance_permissions(self):
        """Test ByteBridge instance permissions"""
        # Owner can view instances
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(reverse('instance-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        
        # Other user cannot view instances
        self.client.force_authenticate(user=self.other_user)
        response = self.client.get(reverse('instance-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 0)
        
        # Other user cannot view specific instance
        response = self.client.get(reverse('instance-detail', args=[self.instance.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        
        # Other user cannot update instance
        data = {'name': 'Hacked Instance'}
        response = self.client.patch(reverse('instance-detail', args=[self.instance.id]), data)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        
        # Other user cannot delete instance
        response = self.client.delete(reverse('instance-detail', args=[self.instance.id]))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
    
    def test_datastore_permissions(self):
        """Test DataStore permissions"""
        # Owner can view all datastores
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(reverse('datastore-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 3)
        
        # Other user can only view public and community datastores
        self.client.force_authenticate(user=self.other_user)
        response = self.client.get(reverse('datastore-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 2)
        
        # Check names of visible datastores
        datastore_names = [ds['name'] for ds in response.data['results']]
        self.assertIn('Public DataStore', datastore_names)
        self.assertIn('Community DataStore', datastore_names)
        self.assertNotIn('Private DataStore', datastore_names)
        
        # Other user cannot update public datastore
        data = {'name': 'Hacked DataStore'}
        response = self.client.patch(reverse('datastore-detail', args=[self.public_datastore.id]), data)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        
        # Other user cannot delete community datastore
        response = self.client.delete(reverse('datastore-detail', args=[self.community_datastore.id]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
    
    def test_bucket_permissions(self):
        """Test Bucket permissions"""
        # Owner can view all buckets
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(reverse('bucket-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 3)
        
        # Other user can only view public and community buckets
        self.client.force_authenticate(user=self.other_user)
        response = self.client.get(reverse('bucket-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 2)
        
        # Other user can create bucket in community datastore
        data = {
            'name': 'New Community Bucket',
            'datastore': self.community_datastore.id,
        }
        response = self.client.post(reverse('bucket-list'), data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        # Other user cannot create bucket in public datastore (read-only)
        data = {
            'name': 'New Public Bucket',
            'datastore': self.public_datastore.id,
        }
        response = self.client.post(reverse('bucket-list'), data)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)