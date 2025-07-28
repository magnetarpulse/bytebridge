from django.test import TestCase
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance, DataStore, Bucket, Object
from django.core.files.uploadedfile import SimpleUploadedFile

class ByteBridgeInstanceModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_12345'
        )
    
    def test_instance_creation(self):
        """Test ByteBridge instance is created correctly"""
        self.assertEqual(self.instance.name, 'Test Instance')
        self.assertEqual(self.instance.owner, self.user)
        self.assertEqual(self.instance.api_token, 'test_token_12345')
        self.assertTrue(self.instance.is_active)
        self.assertIsNone(self.instance.last_connected)

class DataStoreModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_12345'
        )
        self.datastore = DataStore.objects.create(
            name='Test DataStore',
            instance=self.instance,
            owner=self.user,
            permission_type='private',
            description='Test Description'
        )
    
    def test_datastore_creation(self):
        """Test DataStore is created correctly"""
        self.assertEqual(self.datastore.name, 'Test DataStore')
        self.assertEqual(self.datastore.instance, self.instance)
        self.assertEqual(self.datastore.owner, self.user)
        self.assertEqual(self.datastore.permission_type, 'private')
        self.assertEqual(self.datastore.description, 'Test Description')
        self.assertTrue(self.datastore.is_active)

class BucketModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_12345'
        )
        self.datastore = DataStore.objects.create(
            name='Test DataStore',
            instance=self.instance,
            owner=self.user,
            permission_type='public',
        )
        self.bucket = Bucket.objects.create(
            name='Test Bucket',
            datastore=self.datastore,
            owner=self.user,
            is_collection=True
        )
    
    def test_bucket_creation(self):
        """Test Bucket is created correctly"""
        self.assertEqual(self.bucket.name, 'Test Bucket')
        self.assertEqual(self.bucket.datastore, self.datastore)
        self.assertEqual(self.bucket.owner, self.user)
        self.assertTrue(self.bucket.is_collection)
        self.assertIsNone(self.bucket.permission_type)
    
    def test_effective_permission(self):
        """Test bucket inherits permissions from parent datastore"""
        self.assertEqual(self.bucket.get_effective_permission(), 'public')
        
        # Test override
        self.bucket.permission_type = 'private'
        self.bucket.save()
        self.assertEqual(self.bucket.get_effective_permission(), 'private')

class ObjectModelTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_12345'
        )
        self.datastore = DataStore.objects.create(
            name='Test DataStore',
            instance=self.instance,
            owner=self.user,
            permission_type='public',
        )
        self.bucket = Bucket.objects.create(
            name='Test Bucket',
            datastore=self.datastore,
            owner=self.user,
        )
        
        # Create a temporary file
        temp_file = SimpleUploadedFile(
            "test_file.txt",
            b"Test content",
            content_type="text/plain"
        )
        
        self.obj = Object.objects.create(
            name='Test Object',
            bucket=self.bucket,
            file=temp_file,
            content_type='text/plain',
            size=len(b"Test content")
        )
    
    def test_object_creation(self):
        """Test Object is created correctly"""
        self.assertEqual(self.obj.name, 'Test Object')
        self.assertEqual(self.obj.bucket, self.bucket)
        self.assertEqual(self.obj.content_type, 'text/plain')
        self.assertEqual(self.obj.size, len(b"Test content"))