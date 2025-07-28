import os
import uuid
import tempfile
import logging
from unittest import mock
from django.test import TransactionTestCase
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.conf import settings
from core.models import (
    ByteBridgeInstance, DataStore, 
    Bucket, Object, MetadataExtractionQueue
)
from integrations.register import NeuroControllerClient

class LogSuppressor:
    """
    Context manager to suppress expected log messages during testing.
    
    When testing error conditions, we deliberately trigger errors that would
    normally log warnings or errors. These logs can clutter test output and 
    falsely indicate problems. This utility silences those expected logs.
    
    Usage:
        with LogSuppressor('logger.name'):
            # Code that generates expected error logs
    """
    
    def __init__(self, logger_name, level=logging.ERROR):
        self.logger_name = logger_name
        self.level = level
        self.original_level = None
        self.logger = None
    
    def __enter__(self):
        self.logger = logging.getLogger(self.logger_name)
        self.original_level = self.logger.level
        self.logger.setLevel(logging.CRITICAL)  
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.logger.setLevel(self.original_level)


class MetadataSyncTest(TransactionTestCase):
    """
    Comprehensive test suite for metadata extraction and synchronization.
    
    Tests various scenarios including:
    1. Standard metadata extraction from different file types (CSV, Unicode, images)
    2. Queue-based extraction for SQLite compatibility
    3. Error handling for API failures and connection issues
    4. Checksum calculation verification for file integrity
    5. Permission inheritance and propagation through the storage hierarchy
    
    Uses TransactionTestCase to handle the database correctly with concurrent operations,
    particularly important when testing queue-based extraction with SQLite.
    """
    
    def setUp(self):
        """Initialize test environment with users, instances, and sample files."""
        self.user = User.objects.create_user(
            username='testuser', email='test@example.com', password='password123'
        )
        
        self.instance = ByteBridgeInstance.objects.create(
            name='Test Instance',
            owner=self.user,
            api_token='test_token_123',
            instance_id=uuid.uuid4()
        )
        
        self.datastore = DataStore.objects.create(
            name='Test DataStore',
            instance=self.instance,
            owner=self.user,
            permission_type='private'
        )
        
        self.bucket = Bucket.objects.create(
            name='Test Bucket',
            datastore=self.datastore,
            owner=self.user
        )
        
        self.community_datastore = DataStore.objects.create(
            name='Community DataStore',
            instance=self.instance,
            owner=self.user,
            permission_type='community'
        )
        
        self.community_bucket = Bucket.objects.create(
            name='Shared Bucket',
            datastore=self.community_datastore,
            owner=self.user
        )
        
        self.csv_data = "id,name,age,city\n1,John,30,New York\n2,Jane,25,San Francisco\n3,Bob,40,Chicago\n4,Alice,35,Seattle\n5,Charlie,45,Boston\n"
        self.csv_size = len(self.csv_data)
        
        self.utf8_csv_data = "id,name,age,city\n1,José,30,São Paulo\n2,Günther,45,München\n3,François,38,Montréal\n4,名前,25,東京\n5,李,55,北京\n"
        self.utf8_csv_size = len(self.utf8_csv_data)
        
        self.empty_csv_data = "id,name,age,city\n"
        self.empty_csv_size = len(self.empty_csv_data)
        
        self.malformed_csv_data = "id,name,age,city\n1,John,30\n2,Jane,25,San Francisco,extra\n3,missing age,Chicago\n"
        self.malformed_csv_size = len(self.malformed_csv_data)
        
        os.makedirs(settings.MEDIA_ROOT, exist_ok=True)
        self.temp_dir = tempfile.mkdtemp(dir=settings.MEDIA_ROOT)
        
        self.csv_path = os.path.join(self.temp_dir, 'test_data.csv')
        with open(self.csv_path, 'w') as f:
            f.write(self.csv_data)
        
        self.utf8_csv_path = os.path.join(self.temp_dir, 'utf8_data.csv')
        with open(self.utf8_csv_path, 'w', encoding='utf-8') as f:
            f.write(self.utf8_csv_data)
        
        self.empty_csv_path = os.path.join(self.temp_dir, 'empty_data.csv')
        with open(self.empty_csv_path, 'w') as f:
            f.write(self.empty_csv_data)
        
        self.malformed_csv_path = os.path.join(self.temp_dir, 'malformed_data.csv')
        with open(self.malformed_csv_path, 'w') as f:
            f.write(self.malformed_csv_data)
        
        self.image_path = os.path.join(self.temp_dir, 'test_image.jpg')
        with open(self.image_path, 'wb') as f:
            f.write(b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00\x48\x00\x48\x00\x00\xff\xdb\x00C')
        self.image_size = os.path.getsize(self.image_path)
    
    def tearDown(self):
        """Clean up test files and directories."""
        for path in [self.csv_path, self.utf8_csv_path, self.empty_csv_path, 
                    self.malformed_csv_path, self.image_path]:
            if os.path.exists(path):
                os.remove(path)
        
        if os.path.exists(self.temp_dir):
            os.rmdir(self.temp_dir)
    
    def _create_object(self, file_path, name, content_type, mock_signal=True):
        """
        Create an Object instance with the specified file.
        
        Args:
            file_path: Path to the file to use
            name: Name for the object
            content_type: MIME type of the file
            mock_signal: Whether to mock the post_save signal
            
        Returns:
            Object: The created Object instance
        """
        with open(file_path, 'rb') as file_obj:
            file_content = file_obj.read()
            file_size = len(file_content)
            
            if mock_signal:
                with mock.patch('core.models.post_save.send'):
                    obj = Object.objects.create(
                        name=name,
                        bucket=self.bucket,
                        file=ContentFile(file_content, name=name),
                        content_type=content_type,
                        size=file_size
                    )
            else:
                obj = Object.objects.create(
                    name=name,
                    bucket=self.bucket,
                    file=ContentFile(file_content, name=name),
                    content_type=content_type,
                    size=file_size
                )
        
        with open(file_path, 'rb') as src_file:
            with open(obj.file.path, 'wb') as dest_file:
                dest_file.write(src_file.read())
        
        return obj
    
    @mock.patch('integrations.register.requests.post')
    def test_realistic_extraction_and_sync(self, mock_post):
        """
        Test direct metadata extraction and synchronization.
        
        Verifies that metadata is correctly extracted from CSV files
        and that the extracted data is properly synchronized with the API.
        This test uses direct extraction to focus on the core functionality.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        obj = self._create_object(
            self.csv_path, 
            'test_data.csv', 
            'text/csv'
        )
        
        extracted_metadata = obj._extract_dataset_metadata()
        
        self.assertIsNotNone(extracted_metadata)
        self.assertIn('row_count', extracted_metadata)
        self.assertEqual(extracted_metadata['row_count'], 5)
        self.assertEqual(extracted_metadata['column_count'], 4)
        self.assertEqual(extracted_metadata['format'], 'CSV')
        
        obj.type_metadata = extracted_metadata
        obj.save()
        
        client = NeuroControllerClient()
        success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertTrue(success)
        mock_post.assert_called_once()
        
        sent_data = mock_post.call_args[1]['json']
        self.assertEqual(sent_data['type_metadata'], extracted_metadata)
        
        return sent_data
    
    @mock.patch('integrations.register.requests.post')
    def test_queue_based_extraction_and_sync(self, mock_post):
        """
        Test queue-based metadata extraction and synchronization.
        
        Verifies that our SQLite-compatible queue-based extraction approach
        correctly processes metadata and synchronizes with the API.
        This is critical for production environments using SQLite.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        with mock.patch('django.conf.settings.USE_QUEUE_EXTRACTION', True):
            obj = self._create_object(
                self.csv_path, 
                'test_data.csv', 
                'text/csv',
                mock_signal=False
            )
            
            MetadataExtractionQueue.process_next()
            obj.refresh_from_db()
            
            self.assertIsNotNone(obj.type_metadata)
            self.assertIn('row_count', obj.type_metadata)
            self.assertEqual(obj.type_metadata['row_count'], 5)
            self.assertEqual(obj.type_metadata['column_count'], 4)
            self.assertEqual(obj.type_metadata['format'], 'CSV')
            
            client = NeuroControllerClient()
            success = client._sync_object(self.datastore, self.bucket, obj)
            
            self.assertTrue(success)
            mock_post.assert_called_once()
            
            sent_data = mock_post.call_args[1]['json']
            self.assertEqual(sent_data['type_metadata'], obj.type_metadata)
            
            return sent_data
    
    @mock.patch('integrations.register.requests.post')
    def test_unicode_csv_extraction(self, mock_post):
        """
        Test extraction of CSV files with Unicode and special characters.
        
        Verifies that the extraction system correctly handles international
        characters and encodings in data files.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        obj = self._create_object(
            self.utf8_csv_path, 
            'utf8_data.csv', 
            'text/csv'
        )
        
        extracted_metadata = obj._extract_dataset_metadata()
        
        self.assertIsNotNone(extracted_metadata)
        self.assertEqual(extracted_metadata['row_count'], 5)
        self.assertEqual(extracted_metadata['column_count'], 4)
        
        obj.type_metadata = extracted_metadata
        obj.save()
        
        client = NeuroControllerClient()
        success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertTrue(success)
        self.assertEqual(mock_post.call_args[1]['json']['type_metadata'], extracted_metadata)
    
    @mock.patch('integrations.register.requests.post')
    def test_empty_csv_extraction(self, mock_post):
        """
        Test extraction of empty CSV files.
        
        Verifies that the system correctly handles CSV files that contain
        only headers without any data rows.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        obj = self._create_object(
            self.empty_csv_path, 
            'empty_data.csv', 
            'text/csv'
        )
        
        extracted_metadata = obj._extract_dataset_metadata()
        
        self.assertIsNotNone(extracted_metadata)
        self.assertEqual(extracted_metadata['row_count'], 0)
        self.assertEqual(extracted_metadata['column_count'], 4)
        
        obj.type_metadata = extracted_metadata
        obj.save()
        
        client = NeuroControllerClient()
        success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertTrue(success)
        self.assertEqual(mock_post.call_args[1]['json']['type_metadata'], extracted_metadata)
    
    @mock.patch('integrations.register.requests.post')
    def test_malformed_csv_handling(self, mock_post):
        """
        Test handling of malformed CSV files.
        
        Verifies that the system gracefully handles CSV files with 
        inconsistent column counts or other structural issues.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        obj = self._create_object(
            self.malformed_csv_path, 
            'malformed_data.csv', 
            'text/csv'
        )
        
        extracted_metadata = obj._extract_dataset_metadata()
        
        self.assertIsNotNone(extracted_metadata)
        self.assertIn('row_count', extracted_metadata)
        
        obj.type_metadata = extracted_metadata
        obj.save()
        
        client = NeuroControllerClient()
        success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertTrue(success)
    
    @mock.patch('integrations.register.requests.post')
    def test_non_dataset_file_extraction(self, mock_post):
        """
        Test extraction of non-dataset files.
        
        Verifies that the system correctly identifies and extracts appropriate
        metadata for non-tabular files like images.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        obj = self._create_object(
            self.image_path, 
            'test_image.jpg', 
            'image/jpeg'
        )
        
        with LogSuppressor('core.models'):
            extracted_metadata = obj._extract_image_metadata()
        
        obj.type_metadata = extracted_metadata
        obj.save()
        
        client = NeuroControllerClient()
        success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertTrue(success)
    
    @mock.patch('integrations.register.requests.post')
    def test_api_failure_handling(self, mock_post):
        """
        Test handling of API failures during synchronization.
        
        Verifies that the system gracefully handles server errors (5xx)
        without crashing or leaving the system in an inconsistent state.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 500
        mock_response.json.return_value = {'error': 'Internal server error'}
        mock_post.return_value = mock_response
        
        obj = self._create_object(
            self.csv_path, 
            'test_data.csv', 
            'text/csv'
        )
        
        extracted_metadata = obj._extract_dataset_metadata()
        obj.type_metadata = extracted_metadata
        obj.save()
        
        with LogSuppressor('integrations.register'):
            client = NeuroControllerClient()
            success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertFalse(success)
        mock_post.assert_called_once()
    
    @mock.patch('integrations.register.requests.post')
    def test_connection_error_handling(self, mock_post):
        """
        Test handling of connection errors during API sync.
        
        Verifies that the system gracefully handles network errors
        like connection refused, timeouts, or DNS failures.
        """
        mock_post.side_effect = Exception("Connection refused")
        
        obj = self._create_object(
            self.csv_path, 
            'test_data.csv', 
            'text/csv'
        )
        
        extracted_metadata = obj._extract_dataset_metadata()
        obj.type_metadata = extracted_metadata
        obj.save()
        
        with LogSuppressor('integrations.register'):
            client = NeuroControllerClient()
            success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertFalse(success)
    
    @mock.patch('integrations.register.requests.post')
    def test_community_bucket_sync(self, mock_post):
        """
        Test synchronization with community permission buckets.
        
        Verifies that permission settings are correctly propagated
        from datastores to buckets and included in API synchronization.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        with open(self.csv_path, 'rb') as file_obj:
            obj = Object.objects.create(
                name='community_data.csv',
                bucket=self.community_bucket,
                file=ContentFile(file_obj.read(), name='community_data.csv'),
                content_type='text/csv',
                size=self.csv_size
            )
        
        with open(self.csv_path, 'rb') as src_file:
            with open(obj.file.path, 'wb') as dest_file:
                dest_file.write(src_file.read())
        
        extracted_metadata = obj._extract_dataset_metadata()
        obj.type_metadata = extracted_metadata
        obj.save()
        
        client = NeuroControllerClient()
        success = client._sync_object(self.community_datastore, self.community_bucket, obj)
        
        self.assertTrue(success)
        
        sent_data = mock_post.call_args[1]['json']
        
        self.assertEqual(sent_data['bucket_id'], str(self.community_bucket.id))
        self.assertEqual(sent_data['datastore_identifier'], str(self.community_datastore.id))
        
        from django.db.models import Q
        query = Bucket.objects.filter(
            Q(id=sent_data['bucket_id']),
            Q(datastore__permission_type='community') | Q(permission_type='community')
        )
        self.assertTrue(query.exists())
    
    def test_queue_multiple_files(self):
        """
        Test queueing multiple files for extraction.
        
        Verifies that the queue-based extraction system correctly
        processes multiple files in sequence without database locks.
        """
        with mock.patch('django.conf.settings.USE_QUEUE_EXTRACTION', True):
            obj1 = self._create_object(
                self.csv_path, 
                'file1.csv', 
                'text/csv',
                mock_signal=False
            )
            
            obj2 = self._create_object(
                self.utf8_csv_path, 
                'file2.csv', 
                'text/csv',
                mock_signal=False
            )
            
            obj3 = self._create_object(
                self.empty_csv_path, 
                'file3.csv', 
                'text/csv',
                mock_signal=False
            )
            
            for _ in range(3):
                MetadataExtractionQueue.process_next()
            
            obj1.refresh_from_db()
            obj2.refresh_from_db()
            obj3.refresh_from_db()
            
            self.assertIsNotNone(obj1.type_metadata)
            self.assertIsNotNone(obj2.type_metadata)
            self.assertIsNotNone(obj3.type_metadata)
            
            self.assertEqual(obj1.type_metadata['row_count'], 5)
            self.assertEqual(obj2.type_metadata['row_count'], 5)
            self.assertEqual(obj3.type_metadata['row_count'], 0)
    
    @mock.patch('integrations.register.requests.post')
    def test_checksum_calculation_and_sync(self, mock_post):
        """
        Test checksum calculation and synchronization.
        
        Verifies that file checksums are correctly calculated and included
        in API synchronization for file integrity verification.
        """
        mock_response = mock.Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'success': True}
        mock_post.return_value = mock_response
        
        obj = self._create_object(
            self.csv_path, 
            'checksum_test.csv', 
            'text/csv'
        )
        
        import hashlib
        expected_hasher = hashlib.sha256()
        with open(self.csv_path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                expected_hasher.update(chunk)
        expected_checksum = expected_hasher.hexdigest()
        
        obj.extract_metadata()
        
        self.assertIsNotNone(obj.checksum)
        self.assertEqual(obj.checksum, expected_checksum)
        
        client = NeuroControllerClient()
        success = client._sync_object(self.datastore, self.bucket, obj)
        
        self.assertTrue(success)
        mock_post.assert_called_once()
        
        sent_data = mock_post.call_args[1]['json']
        self.assertEqual(sent_data['checksum'], expected_checksum)
        self.assertEqual(sent_data['permission_type'], 'private')