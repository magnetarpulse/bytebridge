#!/usr/bin/env python
import os
import sys
import django
import requests
import uuid
import json
from datetime import datetime

# Setup Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'neurocontroller.settings')
django.setup()

from django.contrib.auth.models import User
from bytebridge.models import ByteBridgeInstance, DataStore, SyncedBucket, SyncedObject

def main():
    print("Starting HTTP-based ByteBridge sync endpoint test...")
    
    try:
        # Get or create test data
        instance, datastore = setup_test_data()
        if not instance or not datastore:
            return
        
        # Test the bucket sync HTTP endpoint
        bucket_ids = test_sync_buckets_http(instance, datastore)
        
        # Test the object sync HTTP endpoint
        if bucket_ids:
            test_sync_objects_http(instance, datastore, bucket_ids[0])
        
        # Verify the results
        verify_results(datastore.id)
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()

def setup_test_data():
    """Set up test data for the HTTP tests"""
    # Try to get the first admin user
    admin_user = User.objects.filter(is_staff=True).first()
    if not admin_user:
        print("No admin users found. Please create an admin user first.")
        return None, None
        
    print(f"Found admin user: {admin_user.username}")
        
    # Try to get an existing instance
    instance = ByteBridgeInstance.objects.first()
    if not instance:
        # Create a test instance
        instance_id = str(uuid.uuid4())
        print(f"Creating test instance with ID: {instance_id}")
        
        instance = ByteBridgeInstance.objects.create(
            name="Test ByteBridge Instance",
            host="localhost",
            port=8000,
            instance_identifier=instance_id,
            owner=admin_user,
            status='online'
        )
        print(f"Created test instance: {instance.name} (ID: {instance.id})")
    else:
        print(f"Using existing instance: {instance.name} (ID: {instance.id})")
        
    # Try to get an existing datastore
    datastore = DataStore.objects.filter(instance=instance).first()
    if not datastore:
        # Create a test datastore
        print(f"Creating test datastore for instance {instance.id}")
        
        datastore = DataStore.objects.create(
            name="Test DataStore",
            instance=instance,
            owner=instance.owner
        )
        print(f"Created test datastore: {datastore.name} (ID: {datastore.id})")
    else:
        print(f"Using existing datastore: {datastore.name} (ID: {datastore.id})")
    
    return instance, datastore

def test_sync_buckets_http(instance, datastore, base_url="http://127.0.0.1:8000"):
    """Test the sync_buckets API endpoint"""
    endpoint = f"{base_url}/api/datastore/sync/buckets/"
    
    # Create mock data for 3 buckets
    bucket_ids = [str(uuid.uuid4()) for _ in range(3)]
    
    mock_data = {
        "instance_identifier": instance.instance_identifier,
        "datastore_id": datastore.id,
        "buckets": [
            {
                "id": bucket_ids[0],
                "name": "HTTP Test Bucket 1",
                "is_collection": False,
                "permission_type": "private",
                "created_at": "2023-01-01T00:00:00Z",
                "last_modified": "2023-01-01T00:00:00Z"
            },
            {
                "id": bucket_ids[1],
                "name": "HTTP Test Bucket 2",
                "is_collection": True,
                "permission_type": "public",
                "created_at": "2023-01-02T00:00:00Z",
                "last_modified": "2023-01-02T00:00:00Z"
            },
            {
                "id": bucket_ids[2],
                "name": "HTTP Test Bucket 3",
                "is_collection": False,
                "permission_type": "private",
                "created_at": "2023-01-03T00:00:00Z",
                "last_modified": "2023-01-03T00:00:00Z"
            }
        ]
    }
    
    print(f"\nTesting sync_buckets HTTP endpoint with {len(mock_data['buckets'])} buckets...")
    print(f"POST URL: {endpoint}")
    print(f"Data: {json.dumps(mock_data, indent=2)}")
    
    try:
        # Make HTTP request to the endpoint
        response = requests.post(endpoint, json=mock_data)
        print(f"Status code: {response.status_code}")
        
        if response.status_code == 200:
            try:
                result = response.json()
                if result.get('success'):
                    print(f"✅ HTTP bucket sync test passed! Processed {result.get('processed')} buckets")
                else:
                    print("❌ HTTP bucket sync test failed: API returned error")
            except json.JSONDecodeError:
                print("❌ HTTP bucket sync test failed: Invalid JSON response")
        else:
            print(f"❌ HTTP bucket sync test failed with status {response.status_code}")
            
        # Check if the buckets were actually created in the database
        for i, bucket_id in enumerate(bucket_ids):
            bucket = SyncedBucket.objects.filter(local_id=bucket_id).first()
            if bucket:
                print(f"✓ Found bucket in database: {bucket.name} (ID: {bucket.id})")
            else:
                print(f"✗ Bucket not found in database: {bucket_id}")
                
        return bucket_ids
        
    except Exception as e:
        print(f"Error during bucket HTTP test: {str(e)}")
        return bucket_ids

def test_sync_objects_http(instance, datastore, bucket_id, base_url="http://127.0.0.1:8000"):
    """Test the sync_objects API endpoint"""
    endpoint = f"{base_url}/api/datastore/sync/objects/"
    
    # Get the synced bucket
    synced_bucket = SyncedBucket.objects.filter(local_id=bucket_id).first()
    if not synced_bucket:
        print(f"❌ Cannot test objects sync: SyncedBucket with local_id {bucket_id} not found")
        return
    
    # Create mock data for 2 objects
    object_ids = [str(uuid.uuid4()) for _ in range(2)]
    
    mock_data = {
        "instance_identifier": instance.instance_identifier,
        "datastore_id": datastore.id,
        "bucket_id": bucket_id,
        "objects": [
            {
                "id": object_ids[0],
                "name": "HTTP Test Object 1.txt",
                "content_type": "text/plain",
                "size": 1024,
                "checksum": "sha256-httptest1",
                "created_at": "2023-01-01T00:00:00Z",
                "last_modified": "2023-01-01T00:00:00Z",
                "permission_type": "private",
                "type_metadata": {"category": "document", "test": "http"}
            },
            {
                "id": object_ids[1],
                "name": "HTTP Test Object 2.jpg",
                "content_type": "image/jpeg",
                "size": 10240,
                "checksum": "sha256-httptest2",
                "created_at": "2023-01-02T00:00:00Z",
                "last_modified": "2023-01-02T00:00:00Z",
                "permission_type": "public",
                "type_metadata": {"category": "image", "test": "http"}
            }
        ]
    }
    
    print(f"\nTesting sync_objects HTTP endpoint with {len(mock_data['objects'])} objects...")
    print(f"POST URL: {endpoint}")
    print(f"Data snippets: bucket_id={bucket_id}, objects=[{mock_data['objects'][0]['name']}, ...]")
    
    try:
        # Make HTTP request to the endpoint
        response = requests.post(endpoint, json=mock_data)
        print(f"Status code: {response.status_code}")
        
        if response.status_code == 200:
            try:
                result = response.json()
                if result.get('success'):
                    print(f"✅ HTTP object sync test passed! Processed {result.get('processed')} objects")
                else:
                    print("❌ HTTP object sync test failed: API returned error")
            except json.JSONDecodeError:
                print("❌ HTTP object sync test failed: Invalid JSON response")
        else:
            print(f"❌ HTTP object sync test failed with status {response.status_code}")
            
        # Check if the objects were actually created in the database
        for i, object_id in enumerate(object_ids):
            obj = SyncedObject.objects.filter(local_id=object_id).first()
            if obj:
                print(f"✓ Found object in database: {obj.name} (ID: {obj.id})")
                print(f"  Content type: {obj.content_type}, Size: {obj.size}")
                print(f"  Metadata: {obj.type_metadata}")
            else:
                print(f"✗ Object not found in database: {object_id}")
                
    except Exception as e:
        print(f"Error during object HTTP test: {str(e)}")

def verify_results(datastore_id):
    """Verify that synced data was stored correctly"""
    print("\nVerifying final database state...")
    
    http_bucket_count = SyncedBucket.objects.filter(
        datastore_id=datastore_id,
        name__startswith="HTTP Test"
    ).count()
    print(f"HTTP Test SyncedBuckets in database: {http_bucket_count}")
    
    http_object_count = SyncedObject.objects.filter(
        datastore_id=datastore_id,
        name__startswith="HTTP Test"
    ).count()
    print(f"HTTP Test SyncedObjects in database: {http_object_count}")
    
    if http_bucket_count > 0 and http_object_count > 0:
        print("✅ HTTP API endpoints are working correctly!")
    else:
        print("❌ HTTP API endpoints may not be working correctly!")

if __name__ == "__main__":
    main()