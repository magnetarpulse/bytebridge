"""
Client module for registering ByteBridge components with NeuroController.

This module provides functionality to register ByteBridge instances and DataStores
with the central NeuroController service, handling authentication and 2FA verification.
"""
import requests
import time
import json
import logging
from django.conf import settings

# Configure logging
logger = logging.getLogger(__name__)

class NeuroControllerClient:
    """
    Client for communicating with NeuroController API.
    
    Handles registration of ByteBridge instances and DataStores,
    including 2FA verification flow when required.
    """
    
    def __init__(self):
        """Initialize client with base URL from settings."""
        self.base_url = settings.NEUROCONTROLLER_URL
    
    def register_bytebridge(self, instance, id_token, verifier_token, register_token, 
                           poll_timeout=900, poll_interval=2):
        """
        Register a ByteBridge instance with NeuroController.
        
        Args:
            instance: ByteBridgeInstance object to register
            id_token: Admin identification token
            verifier_token: One-time verifier token
            register_token: ByteBridge register token
            poll_timeout: Maximum time in seconds to poll for 2FA approval (default: 900s = 15min)
            poll_interval: Time in seconds between polling attempts (default: 2s)
        
        Returns:
            tuple: (success_flag, response_object, error_message)
        """
        endpoint = f"{self.base_url}/api/bytebridge/register"
        
        headers = {
            'Content-Type': 'application/json',
            'X-Id-Token': id_token,
            'X-Verifier-Token': verifier_token,
            'X-Operation-Token': register_token,
            "X-Operation-Type": "bytebridge_operation",
        }
        
        data = {
            'name': instance.name,
            'host': settings.API_HOST,  
            'port': settings.API_PORT,  
            'api_endpoint': f"{settings.API_PROTOCOL}://{settings.API_HOST}:{settings.API_PORT}/api/v1",  
            'owner_username': instance.owner.username,
            'owner_email': instance.owner.email,
            'instance_identifier': str(instance.instance_id)
        }
        
        # Initial request
        try:
            response = requests.post(endpoint, json=data, headers=headers, timeout=30)
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to connect to NeuroController: {e}")
            return False, None, f"Connection error: {str(e)}"
        
        # Handle successful response
        if response.status_code == 200:
            try:
                # Validate JSON response
                response.json()  
                logger.info(f"ByteBridge instance registered successfully: {instance.name}")
                return True, response, None
            except json.JSONDecodeError:
                logger.error("Received invalid JSON in successful response")
                return False, response, "Invalid response format"
        
        # Handle 2FA verification
        elif response.status_code == 401:
            return self._handle_2fa_verification(
                response, endpoint, data, headers, poll_timeout, poll_interval
            )
        
        # Handle other errors
        else:
            error_msg = f"Registration failed with status code {response.status_code}"
            try:
                error_details = response.json()
                error_msg += f": {error_details}"
            except (json.JSONDecodeError, ValueError):
                error_msg += f": {response.text}"
            
            logger.error(error_msg)
            return False, response, error_msg
    
    def register_datastore(self, datastore, id_token, verifier_token, register_token, 
                          poll_timeout=900, poll_interval=2):
        """
        Register a DataStore with NeuroController.
        
        Args:
            datastore: DataStore object to register
            id_token: Admin identification token
            verifier_token: One-time verifier token
            register_token: DataStore register token
            poll_timeout: Maximum time in seconds to poll for 2FA approval (default: 900s = 15min)
            poll_interval: Time in seconds between polling attempts (default: 2s)
        
        Returns:
            tuple: (success_flag, response_object, error_message)
        """
        endpoint = f"{self.base_url}/api/datastore/register"
        
        headers = {
            'Content-Type': 'application/json',
            'X-Id-Token': id_token,
            'X-Verifier-Token': verifier_token,
            'X-Operation-Token': register_token,
            'X-Operation-Type': 'datastore_operation'
        }
        
        data = {
            'name': datastore.name,
            'instance_identifier': str(datastore.instance.instance_id),
            'permission_type': datastore.permission_type,
            'owner_username': datastore.owner.username,
            'description': getattr(datastore, 'description', '')
        }
        
        # Initial request
        try:
            response = requests.post(endpoint, json=data, headers=headers, timeout=30)
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to connect to NeuroController: {e}")
            return False, None, f"Connection error: {str(e)}"
            
        # Handle successful response
        if response.status_code == 200:
            try:
                # Validate JSON response
                response.json()  
                logger.info(f"DataStore registered successfully: {datastore.name}")
                return True, response, None
            except json.JSONDecodeError:
                logger.error("Received invalid JSON in successful response")
                return False, response, "Invalid response format"
                
        # Handle 2FA verification
        elif response.status_code == 401:
            return self._handle_2fa_verification(
                response, endpoint, data, headers, poll_timeout, poll_interval
            )
            
        # Handle other errors
        else:
            error_msg = f"Registration failed with status code {response.status_code}"
            try:
                error_details = response.json()
                error_msg += f": {error_details}"
            except (json.JSONDecodeError, ValueError):
                error_msg += f": {response.text}"
                
            logger.error(error_msg)
            return False, response, error_msg
            
    def _handle_2fa_verification(self, response, endpoint, data, headers, poll_timeout, poll_interval):
        """
        Handle 2FA verification flow.
        
        Args:
            response: Initial response indicating 2FA is required
            endpoint: API endpoint to call after 2FA approval
            data: Request data to submit
            headers: Request headers
            poll_timeout: Maximum polling time in seconds
            poll_interval: Time between polling attempts in seconds
            
        Returns:
            tuple: (success_flag, response_object, error_message)
        """
        try:
            # Parse the response text as JSON
            try:
                response_data = json.loads(response.text)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse response as JSON: {e}")
                return False, response, f"Invalid 2FA response format: {str(e)}"
            
            # Check if we have a pending verification
            if isinstance(response_data, dict) and 'error' in response_data:
                error_data = response_data['error']
                
                if isinstance(error_data, dict) and error_data.get('status') == 'pending_verification':
                    # Get polling URL and request ID
                    poll_url = error_data.get('poll_url')
                    request_id = error_data.get('request_id')
                    
                    if not poll_url or not request_id:
                        logger.error("Missing poll_url or request_id in response")
                        return False, response, "Missing 2FA verification details"
                    
                    logger.info(f"2FA verification required. Request ID: {request_id}")
                    logger.info(f"Polling for approval at {poll_url}")
                    
                    # Create the complete poll URL
                    full_poll_url = f"{self.base_url}{poll_url}"
                    
                    # Poll for approval
                    return self._poll_for_approval(
                        full_poll_url, request_id, endpoint, data, headers, 
                        poll_timeout, poll_interval
                    )
        except Exception as e:
            logger.exception(f"Error handling 2FA response: {e}")
            return False, response, f"2FA verification error: {str(e)}"
            
        # If we reach here, the 401 wasn't related to 2FA
        logger.error(f"Authentication failed: {response.text}")
        return False, response, "Authentication failed"
    
    def _poll_for_approval(self, poll_url, request_id, endpoint, data, headers, 
                          poll_timeout, poll_interval):
        """
        Poll for 2FA approval.
        
        Args:
            poll_url: URL to poll for approval status
            request_id: ID of the 2FA request
            endpoint: API endpoint to call after approval
            data: Request data to submit
            headers: Request headers
            poll_timeout: Maximum polling time in seconds
            poll_interval: Time between polling attempts in seconds
            
        Returns:
            tuple: (success_flag, response_object, error_message)
        """
        start_time = time.time()
        while time.time() - start_time < poll_timeout:
            elapsed = int(time.time() - start_time)
            logger.info(f"Polling for 2FA approval... (elapsed: {elapsed}s)")
            
            try:
                # Check verification status
                poll_response = requests.get(poll_url, timeout=10)
                
                if poll_response.status_code == 200:
                    try:
                        poll_data = poll_response.json()
                        status = poll_data.get('status')
                        
                        if status == 'approved':
                            logger.info("2FA verification approved!")
                            approval_token = poll_data.get('approval_token')
                            
                            # Add approval headers to the original request
                            new_headers = headers.copy()
                            if approval_token:
                                new_headers['X-Approval-Token'] = approval_token
                                new_headers['X-Request-ID'] = request_id
                            
                            # Re-submit the original request with approval tokens
                            try:
                                final_response = requests.post(
                                    endpoint, json=data, headers=new_headers, timeout=30
                                )
                                
                                # Check if the final request was successful
                                if final_response.status_code == 200:
                                    logger.info("Registration successful after 2FA approval")
                                    return True, final_response, None
                                else:
                                    error_msg = f"Registration failed after 2FA approval: {final_response.status_code}"
                                    logger.error(error_msg)
                                    return False, final_response, error_msg
                            except requests.exceptions.RequestException as e:
                                logger.error(f"Error submitting request after 2FA approval: {e}")
                                return False, None, f"Connection error after 2FA approval: {str(e)}"
                                
                        elif status == 'rejected':
                            logger.warning("2FA verification rejected by user")
                            return False, poll_response, "2FA verification rejected by user"
                            
                        elif status == 'expired':
                            logger.warning("2FA verification request expired")
                            return False, poll_response, "2FA verification expired"
                    except json.JSONDecodeError as e:
                        logger.error(f"Error parsing poll response: {e}")
                else:
                    logger.error(f"Polling failed with status code: {poll_response.status_code}")
            except requests.exceptions.RequestException as e:
                logger.error(f"Error polling for 2FA approval: {e}")
            
            # Wait before polling again
            time.sleep(poll_interval)
        
        # If we get here, we timed out
        logger.error(f"Timed out waiting for 2FA approval after {poll_timeout} seconds")
        return False, None, f"2FA verification timed out after {poll_timeout} seconds"
    
    def sync_datastore_contents(self, datastore, auth_token=None):
        """
        Synchronize all buckets and objects in a DataStore with NeuroController.
        
        This method collects all buckets in the datastore and sends them as a batch,
        then does the same for objects in each bucket.
        
        Args:
            datastore (DataStore): The DataStore object to synchronize
            auth_token (str, optional): Authentication token for NeuroController API
                
        Returns:
            tuple: A tuple containing:
                - bool: Success flag indicating if the overall sync was successful
                - dict: Statistics about the synchronization process
                - str: Error message if any, None if successful
        """
        print(f"[SYNC] Starting synchronization for DataStore: {datastore.name} (ID: {datastore.id})")
        
        # 1. Get all buckets for this datastore
        buckets = datastore.buckets.all()
        print(f"[SYNC] Found {buckets.count()} buckets to synchronize")
        
        # Initialize statistics
        stats = {
            'buckets_synced': 0,
            'buckets_failed': 0,
            'objects_synced': 0, 
            'objects_failed': 0
        }
    
        # 2. Prepare buckets data in batch format
        bucket_list = []
        for bucket in buckets:
            bucket_list.append({
                'id': str(bucket.id),
                'name': bucket.name,
                'is_collection': bucket.is_collection,
                'permission_type': bucket.get_effective_permission(),
                'created_at': bucket.created_at.isoformat() if bucket.created_at else None,
                'last_modified': bucket.last_modified.isoformat() if hasattr(bucket, 'last_modified') and bucket.last_modified else None
            })
        
        # 3. Send buckets as a batch
        if bucket_list:
            print(f"[SYNC] Sending {len(bucket_list)} buckets in batch")
            buckets_success = self._sync_buckets_batch(datastore, bucket_list, auth_token)
            
            if buckets_success:
                print(f"[SYNC] ✓ All buckets synchronized successfully")
                stats['buckets_synced'] = len(bucket_list)
                
                # 4. For each bucket, sync its objects
                for bucket in buckets:
                    objects = bucket.stored_objects.all()
                    if objects.count() > 0:
                        print(f"[SYNC] Found {objects.count()} objects in bucket {bucket.name}")
                        object_list = []
                        
                        for obj in objects:
                            object_list.append({
                                'id': str(obj.id),
                                'name': obj.name,
                                'content_type': obj.content_type,
                                'size': obj.size,
                                'checksum': obj.checksum or "",
                                'created_at': obj.created_at.isoformat() if obj.created_at else None,
                                'last_modified': obj.last_modified.isoformat() if hasattr(obj, 'last_modified') and obj.last_modified else None,
                                'bucket_id': str(bucket.id),
                                'type_metadata': obj.type_metadata if hasattr(obj, 'type_metadata') and obj.type_metadata else {},
                                'permission_type': bucket.get_effective_permission()
                            })
                        
                        # Send objects as a batch
                        if object_list:
                            objects_success = self._sync_objects_batch(datastore, bucket, object_list, auth_token)
                            if objects_success:
                                print(f"[SYNC] ✓ All objects in {bucket.name} synchronized successfully")
                                stats['objects_synced'] += len(object_list)
                            else:
                                print(f"[SYNC] ✗ Failed to synchronize objects in {bucket.name}")
                                stats['objects_failed'] += len(object_list)
            else:
                print(f"[SYNC] ✗ Failed to synchronize buckets")
                stats['buckets_failed'] = len(bucket_list)
        
        print(f"[SYNC] Synchronization complete for DataStore {datastore.name}")
        print(f"[SYNC] Summary: {stats['buckets_synced']}/{buckets.count()} buckets synchronized")
        print(f"[SYNC] Objects: {stats['objects_synced']} synchronized, {stats['objects_failed']} failed")
        
        return True, stats, None
    
    def _sync_buckets_batch(self, datastore, bucket_list, auth_token=None):
        """
        Synchronize multiple buckets with NeuroController in batch mode.
        
        Args:
            datastore (DataStore): The parent DataStore object
            bucket_list (list): List of bucket data dictionaries
            auth_token (str, optional): Authentication token for NeuroController API
            
        Returns:
            bool: True if synchronization was successful, False otherwise
        """
        endpoint = f"{self.base_url}/api/datastore/sync/buckets"
        
        headers = {'Content-Type': 'application/json'}
        if auth_token:
            headers['Authorization'] = f"Bearer {auth_token}"
        
        data = {
            'instance_identifier': str(datastore.instance.instance_id),
            'datastore_id': 8,
            'buckets': bucket_list
        }
    
        print(f"[SYNC_BUCKETS] Sending {len(bucket_list)} buckets to {endpoint}")
        
        try:
            response = requests.post(endpoint, json=data, headers=headers, timeout=30)
            print(f"[SYNC_BUCKETS] Response status: {response.status_code}")
            
            if response.status_code != 200:
                print(f"[SYNC_BUCKETS] Error response: {response.text[:200]}")
                logger.error(f"Failed to sync buckets: HTTP {response.status_code}")
                return False
                
            try:
                response_data = response.json()
                print(f"[SYNC_BUCKETS] Response: {response_data}")
            except:
                print("[SYNC_BUCKETS] Response not JSON format")
                
            return True
        except Exception as e:
            print(f"[SYNC_BUCKETS] Exception: {str(e)}")
            logger.error(f"Failed to sync buckets: {str(e)}")
            return False
    
    def _sync_objects_batch(self, datastore, bucket, object_list, auth_token=None):
        """
        Synchronize multiple objects with NeuroController in batch mode.
        
        Args:
            datastore (DataStore): The parent DataStore object
            bucket (Bucket): The parent Bucket object
            object_list (list): List of object data dictionaries
            auth_token (str, optional): Authentication token for NeuroController API
            
        Returns:
            bool: True if synchronization was successful, False otherwise
        """
        endpoint = f"{self.base_url}/api/datastore/sync/objects"
        
        headers = {'Content-Type': 'application/json'}
        if auth_token:
            headers['Authorization'] = f"Bearer {auth_token}"
    
        data = {
            'instance_identifier': str(datastore.instance.instance_id),
            'datastore_id': 8,
            'bucket_id': bucket.id,
            'objects': object_list
        }
        
        print(f"[SYNC_OBJECTS] Sending {len(object_list)} objects to {endpoint}")
        
        try:
            response = requests.post(endpoint, json=data, headers=headers, timeout=30)
            print(f"[SYNC_OBJECTS] Response status: {response.status_code}")
            
            if response.status_code != 200:
                print(f"[SYNC_OBJECTS] Error response: {response.text[:200]}")
                logger.error(f"Failed to sync objects: HTTP {response.status_code}")
                return False
                
            try:
                response_data = response.json()
                print(f"[SYNC_OBJECTS] Response: {response_data}")
            except:
                print("[SYNC_OBJECTS] Response not JSON format")
                
            return True
        except Exception as e:
            print(f"[SYNC_OBJECTS] Exception: {str(e)}")
            logger.error(f"Failed to sync objects: {str(e)}")
            return False
    
    def _sync_bucket(self, datastore, bucket, auth_token=None):
        """
        Synchronize a single bucket's metadata with NeuroController.
        
        Sends bucket metadata to NeuroController to create or update the bucket record
        in the central registry.
        
        Args:
            datastore (DataStore): The parent DataStore object
            bucket (Bucket): The Bucket object to synchronize
            auth_token (str, optional): Authentication token for NeuroController API
            
        Returns:
            bool: True if synchronization was successful, False otherwise
        """
        endpoint = f"{self.base_url}/api/datastore/sync/buckets"
        
        headers = {'Content-Type': 'application/json'}
        if auth_token:
            headers['Authorization'] = f"Bearer {auth_token}"
        
        data = {
            'name': bucket.name,
            'is_collection': bucket.is_collection,
            'permission_type': bucket.get_effective_permission(), 
            'local_id': str(bucket.id),
            'datastore_id': 8,
            'datastore_identifier': str(datastore.id),
            'instance_identifier': str(datastore.instance.instance_id)
        }
    
        print(f"[SYNC_BUCKET] Sending bucket data to {endpoint}")
        print(f"[SYNC_BUCKET] Bucket: {bucket.name} (ID: {bucket.id})")
        
        try:
            response = requests.post(endpoint, json=data, headers=headers, timeout=30)
            print(f"[SYNC_BUCKET] Response status: {response.status_code}")
            
            if response.status_code != 200:
                print(f"[SYNC_BUCKET] Error response: {response.text[:200]}")
                logger.error(f"Failed to sync bucket {bucket.name}: HTTP {response.status_code}")
                return False
                
            try:
                response_data = response.json()
                print(f"[SYNC_BUCKET] Response: {response_data}")
            except:
                print("[SYNC_BUCKET] Response not JSON format")
                
            return True
        except Exception as e:
            print(f"[SYNC_BUCKET] Exception: {str(e)}")
            logger.error(f"Failed to sync bucket {bucket.name}: {str(e)}")
            return False
    
    def _sync_object(self, datastore, bucket, obj, auth_token=None):
        """
        Synchronize a single object's metadata with NeuroController.
        
        Sends object metadata to NeuroController to create or update the object record
        in the central registry. This does NOT transfer the actual file content.
        
        Args:
            datastore (DataStore): The parent DataStore object
            bucket (Bucket): The parent Bucket object
            obj (Object): The Object to synchronize
            auth_token (str, optional): Authentication token for NeuroController API
            
        Returns:
            bool: True if synchronization was successful, False otherwise
        """
        endpoint = f"{self.base_url}/api/datastore/sync/objects"
        
        headers = {'Content-Type': 'application/json'}
        if auth_token:
            headers['Authorization'] = f"Bearer {auth_token}"
    
        permission_type = bucket.get_effective_permission()
        
        data = {
            'name': obj.name,
            'content_type': obj.content_type,
            'size': obj.size,
            'checksum': obj.checksum or "",  
            'created_at': obj.created_at.isoformat() if obj.created_at else None,
            'last_modified': obj.last_modified.isoformat() if hasattr(obj, 'last_modified') and obj.last_modified else None,
            'local_id': str(obj.id),
            'bucket_id': str(bucket.id),
            'datastore_id': 8,  
            'datastore_identifier': str(datastore.id),
            'instance_identifier': str(datastore.instance.instance_id),
            'type_metadata': obj.type_metadata if hasattr(obj, 'type_metadata') and obj.type_metadata else {},
            'permission_type': permission_type 
        }
        
        print(f"[SYNC_OBJECT] Sending object data to {endpoint}")
        print(f"[SYNC_OBJECT] Object: {obj.name} (ID: {obj.id})")
    
        try:
            response = requests.post(endpoint, json=data, headers=headers, timeout=30)
            print(f"[SYNC_OBJECT] Response status: {response.status_code}")
            
            if response.status_code != 200:
                print(f"[SYNC_OBJECT] Error response: {response.text[:200]}")
                logger.error(f"Failed to sync object {obj.name}: HTTP {response.status_code}")
                return False
                
            try:
                response_data = response.json()
                print(f"[SYNC_OBJECT] Response: {response_data}")
            except:
                print("[SYNC_OBJECT] Response not JSON format")
                
            return True
        except Exception as e:
            print(f"[SYNC_OBJECT] Exception: {str(e)}")
            logger.error(f"Failed to sync object {obj.name}: HTTP {response.status_code}")
            return False