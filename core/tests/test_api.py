from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase, APIClient
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance, DataStore

class ByteBridgeInstanceAPITest(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        self.client.force_authenticate(user=self.user)
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_12345'
        )
        self.list_url = reverse('instance-list')
        self.detail_url = reverse('instance-detail', args=[self.instance.id])
    
    def test_list_instances(self):
        """Test retrieving list of ByteBridge instances"""
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['name'], 'Test Instance')
    
    def test_create_instance(self):
        """Test creating a new ByteBridge instance"""
        data = {
            'name': 'New Instance',
            'api_token': 'new_token_67890'
        }
        response = self.client.post(self.list_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(ByteBridgeInstance.objects.count(), 2)
        new_instance = ByteBridgeInstance.objects.get(name='New Instance')
        self.assertEqual(new_instance.owner, self.user)
    
    def test_retrieve_instance(self):
        """Test retrieving a ByteBridge instance"""
        response = self.client.get(self.detail_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Test Instance')
    
    def test_update_instance(self):
        """Test updating a ByteBridge instance"""
        data = {'name': 'Updated Instance'}
        response = self.client.patch(self.detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.instance.refresh_from_db()
        self.assertEqual(self.instance.name, 'Updated Instance')
    
    def test_delete_instance(self):
        """Test deleting a ByteBridge instance"""
        response = self.client.delete(self.detail_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(ByteBridgeInstance.objects.count(), 0)
    
    def test_connect_to_controller(self):
        """Test connect to controller action"""
        connect_url = reverse('instance-connect-to-controller', args=[self.instance.id])
        response = self.client.post(connect_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'connection initiated')
        self.instance.refresh_from_db()
        self.assertIsNotNone(self.instance.last_connected)

class DataStoreAPITest(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='testuser',
            password='testpassword'
        )
        self.client.force_authenticate(user=self.user)
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
        )
        self.list_url = reverse('datastore-list')
        self.detail_url = reverse('datastore-detail', args=[self.datastore.id])
    
    def test_list_datastores(self):
        """Test retrieving list of DataStores"""
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['name'], 'Test DataStore')
    
    def test_create_datastore(self):
        """Test creating a new DataStore"""
        data = {
            'name': 'New DataStore',
            'instance': self.instance.id,
            'permission_type': 'public',
            'description': 'New Description'
        }
        response = self.client.post(self.list_url, data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(DataStore.objects.count(), 2)
        new_datastore = DataStore.objects.get(name='New DataStore')
        self.assertEqual(new_datastore.owner, self.user)
        self.assertEqual(new_datastore.permission_type, 'public')
    
    def test_retrieve_datastore(self):
        """Test retrieving a DataStore"""
        response = self.client.get(self.detail_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Test DataStore')
    
    def test_update_datastore(self):
        """Test updating a DataStore"""
        data = {
            'name': 'Updated DataStore',
            'permission_type': 'community'
        }
        response = self.client.patch(self.detail_url, data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.datastore.refresh_from_db()
        self.assertEqual(self.datastore.name, 'Updated DataStore')
        self.assertEqual(self.datastore.permission_type, 'community')
    
    def test_delete_datastore(self):
        """Test deleting a DataStore"""
        response = self.client.delete(self.detail_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(DataStore.objects.count(), 0)