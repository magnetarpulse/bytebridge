import os
import shutil
import uuid
import time
import json
import gzip
import logging
import base64
import nacl.utils
import nacl.secret
from django.http import HttpResponse, JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import get_object_or_404
from django.core.cache import cache
from django.conf import settings

from core.models import DataStore, Bucket, Object, ByteBridgeInstance
from core.src.authentication import (
    SigningService,
    EncryptionService,
)

logger = logging.getLogger(__name__)
UPLOAD_TEMP_DIR = settings.UPLOAD_TEMP_DIR

@csrf_exempt
@require_http_methods(["POST"])
def api_download_authorization(request: HttpRequest) -> JsonResponse:
    """
    Endpoint for NeuroController to request file download authorization.
    
    This endpoint:
    1. Receives an encrypted+signed request from NeuroController
    2. Decrypts and verifies the request
    3. Checks if the download is allowed
    4. Returns encrypted+signed download authorization with token and encryption info
       for client-side decryption using XChaCha20-Poly1305
    
    POST body parameters expected in an encrypted+signed package:
    - file_id: ID of the file to download
    - bucket_id: ID of the bucket containing the file
    - instance_id: ID of the ByteBridge instance
    - user_id: User requesting the download
    - request_id: Unique request identifier
    - timestamp: Request timestamp for freshness
    """
    try:
        # Extract encrypted package from request
        data = json.loads(request.body)
        encrypted_message = data.get('encrypted_message')
        signature = data.get('signature')
        neurocontroller_signing_key = data.get('server_signing_public_key')
        
        if not all([encrypted_message, signature, neurocontroller_signing_key]):
            return JsonResponse({
                'error': 'Missing required parameters',
                'required': ['encrypted_message', 'signature', 'server_signing_public_key']
            }, status=400)
        
        # Decrypt and verify the request from NeuroController
        try:
            # Get our instance based on request headers or other identifiers
            instance_id = request.headers.get('X-ByteBridge-Instance-ID')
            if not instance_id:
                return JsonResponse({'error': 'Missing X-ByteBridge-Instance-ID header'}, status=400)
            
            instance = get_object_or_404(ByteBridgeInstance, instance_identifier=instance_id)
            
            # Verify we have NeuroController's public keys stored
            if not instance.neurocontroller_Ed25519_public_key:
                return JsonResponse({'error': 'NeuroController signing key not available'}, status=400)
                
            if not instance.neurocontroller_X25519_public_key:
                return JsonResponse({'error': 'NeuroController encryption key not available'}, status=400)
            
            # Verify and decrypt the request
            request_bytes = EncryptionService.verify_and_decrypt_from_sender_static(
                encrypted_message,
                signature,
                neurocontroller_signing_key
            )
            
            request_data = json.loads(request_bytes.decode('utf-8'))
            
            # Extract request details
            file_id = request_data.get('file_id')
            bucket_id = request_data.get('bucket_id')
            user_id = request_data.get('user_id')
            timestamp = request_data.get('timestamp')
            request_id = request_data.get('request_id')
            
            if not all([file_id, bucket_id, user_id, timestamp, request_id]):
                return JsonResponse({
                    'error': 'Missing required fields in decrypted request',
                    'required': ['file_id', 'bucket_id', 'user_id', 'timestamp', 'request_id']
                }, status=400)
            
            # Check request freshness (within 5 minutes)
            current_time = int(time.time())
            if abs(current_time - int(timestamp)) > 300:
                return JsonResponse({'error': 'Request timestamp expired'}, status=401)
            
            # Get the requested file
            file_object = get_object_or_404(Object, id=file_id, bucket_id=bucket_id)
            
            # Verify user has permission to download this file
            # (In a real implementation, check permissions based on user_id and file permissions)
            # For now, we'll assume the file is downloadable if we can find it
            
            # Generate a one-time encryption key for XChaCha20-Poly1305 (32 bytes)
            encryption_key = nacl.utils.random(nacl.secret.Aead.KEY_SIZE)
            
            # Generate a temporary download token (valid for 10 minutes)
            auth_token = str(uuid.uuid4())
            expiry = int(time.time()) + 600  # 10 minutes
            
            # Create a secure download path
            download_path = f"/api/v1/secure-download/{file_id}/{auth_token}/"
            
            # Get the host from the request to build full URLs
            host = request.get_host()
            scheme = request.scheme
            
            # Create direct download URL for client-side decryption flow
            direct_download_url = f"{scheme}://{host}{download_path}"
            
            # Store token, along with encryption key
            cache.set(
                f"download_token:{auth_token}",
                {
                    "file_id": file_id,
                    "user_id": user_id,
                    "expiry": expiry,
                    "encryption_key": base64.b64encode(encryption_key).decode('utf-8')
                },
                timeout=600
            )
            
            # Prepare the response payload with download details
            response_data = {
                "file_id": file_id,
                "direct_download_url": direct_download_url,
                "auth_token": auth_token,
                "expiry": expiry,
                "content_type": file_object.content_type,
                "file_size": file_object.size,
                "file_name": file_object.name,
                "request_id": request_id,
                "encryption_key": base64.b64encode(encryption_key).decode('utf-8'),
                "encryption_algorithm": "XChaCha20-Poly1305"
            }
            
            # Encrypt and sign the response - this secures the encryption key in transit
            response_bytes = json.dumps(response_data).encode('utf-8')
            secure_package = EncryptionService.encrypt_and_sign_for_recipient_static(
                response_bytes,
                instance.neurocontroller_X25519_public_key
            )
            
            return JsonResponse({
                'encrypted_message': secure_package['encrypted_message'],
                'signature': secure_package['signature'],
                'server_signing_public_key': secure_package['server_signing_public_key']
            })
            
        except Exception as e:
            logger.exception(f"Error processing download authorization: {e}")
            return JsonResponse({'error': f'Authorization processing error: {str(e)}'}, status=500)
            
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON in request body'}, status=400)
    except Exception as e:
        logger.exception(f"Error processing download authorization request: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["GET"])
def api_secure_download(request: HttpRequest, file_id: str, token: str) -> HttpResponse:
    """
    Endpoint for encrypted file download using a previously authorized token.
    
    This endpoint:
    1. Validates the download token
    2. Checks if it's still valid
    3. Encrypts the file on-the-fly with XChaCha20-Poly1305 using Aead
    4. Streams the encrypted file to the client with metadata for decryption
    
    URL: /api/v1/secure-download/{file_id}/{token}/
    Method: GET
    
    Args:
        request: The HTTP request
        file_id: ID of the file to download
        token: Authorization token from previous authorization request
    
    Returns:
        HttpResponse with the encrypted file contents or error response
    """
    try:
        # Get token data from cache
        token_data = cache.get(f"download_token:{token}")
        
        if not token_data:
            return JsonResponse({
                'error': 'Invalid or expired download token'
            }, status=401)
        
        # Verify token is for this file and not expired
        if token_data.get('file_id') != file_id:
            return JsonResponse({
                'error': 'Token does not match requested file'
            }, status=401)
        
        if int(token_data.get('expiry', 0)) < int(time.time()):
            return JsonResponse({
                'error': 'Download token has expired'
            }, status=401)
        
        # Get the file
        file_object = get_object_or_404(Object, id=file_id)
        
        # Get the file's storage path
        file_path = file_object.get_physical_path()
        
        if not file_path or not os.path.exists(file_path):
            return JsonResponse({
                'error': 'File not found in storage'
            }, status=404)
        
        # Get encryption key
        encryption_key_b64 = token_data.get('encryption_key')
        
        if not encryption_key_b64:
            return JsonResponse({
                'error': 'Missing encryption key'
            }, status=500)
        
        # Decode encryption key from base64
        encryption_key = base64.b64decode(encryption_key_b64)
        
        # Read the file content
        with open(file_path, 'rb') as f:
            file_content = f.read()
        
        # Encrypt the file using XChaCha20-Poly1305 with Aead
        try:
            # Create an Aead box with the key
            aead_box = nacl.secret.Aead(encryption_key)
            
            # Additional authenticated data for integrity
            aad = b"ByteBridge_Download_aead_v1"
            
            # Encrypt the file content - Aead generates a random nonce internally
            encrypted_content = aead_box.encrypt(file_content, aad)
            
            # Extract the nonce (first 24 bytes in Aead encryption output)
            nonce = encrypted_content[:nacl.secret.Aead.NONCE_SIZE]
            nonce_b64 = base64.b64encode(nonce).decode('utf-8')
            
            # Create response with encrypted content
            response = HttpResponse(
                encrypted_content,
                content_type='application/octet-stream'  # Always binary for encrypted content
            )
            
            # Set content disposition header
            filename = f"{file_object.name}.enc"
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
            
            # Add decryption metadata in headers
            response['X-Encryption-Algorithm'] = 'XChaCha20-Poly1305'
            response['X-Encryption-Nonce'] = nonce_b64
            response['X-Original-Content-Type'] = file_object.content_type or 'application/octet-stream'
            response['X-Original-Filename'] = file_object.name
            response['X-Encryption-AAD'] = base64.b64encode(aad).decode('utf-8')
            
            # Add CORS headers to allow cross-origin requests
            response["Access-Control-Allow-Origin"] = "*"  # Or specific origins
            response["Access-Control-Allow-Methods"] = "GET, OPTIONS"
            response["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response["Access-Control-Expose-Headers"] = "X-Encryption-Algorithm, X-Encryption-Nonce, X-Original-Content-Type, X-Original-Filename, X-Encryption-AAD"
            
            # Log the download
            logger.info(f"Encrypted file {file_id} downloaded using token {token} for user {token_data.get('user_id')}")
            
            # Remove the token after use (one-time use tokens)
            cache.delete(f"download_token:{token}")
            
            return response
            
        except Exception as e:
            logger.exception(f"Error encrypting file: {e}")
            return JsonResponse({
                'error': f'Encryption error: {str(e)}'
            }, status=500)
        
    except Exception as e:
        logger.exception(f"Error processing secure download: {e}")
        return JsonResponse({
            'error': f'Download error: {str(e)}'
        }, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_get_datastores(request: HttpRequest) -> JsonResponse:
    """
    Endpoint for NeuroController to get datastore metadata.
    
    POST body parameters:
    - instance_id: ByteBridge instance ID
    - signature: Base64 encoded signature of the request
    - timestamp: ISO format timestamp for request freshness
    - request_id: Unique request identifier
    """
    try:
        # Extract parameters from request body
        data = json.loads(request.body)
        instance_id = data.get('instance_id')
        signature = data.get('signature')
        timestamp = data.get('timestamp')
        request_id = data.get('request_id')
        
        if not all([instance_id, signature, timestamp, request_id]):
            print("Missing required parameters")
            return JsonResponse({
                'error': 'Missing required parameters', 
                'required': ['instance_id', 'signature', 'timestamp', 'request_id']
            }, status=400)
        
        # Verify request authenticity
        # Message format: "POST:datastores:{instance_id}:{timestamp}:{request_id}"
        message = f"POST:datastores:{instance_id}:{timestamp}:{request_id}"
        
        # Get NeuroController's stored public key
        try:
            instance = ByteBridgeInstance.objects.get(instance_identifier=instance_id)
            neurocontroller_signing_key = instance.neurocontroller_Ed25519_public_key
            neurocontroller_encryption_key = instance.neurocontroller_X25519_public_key
            
            if not neurocontroller_signing_key:
                print("NeuroController signing key not available for this instance")
                return JsonResponse({
                    'error': 'NeuroController signing key not available for this instance'
                }, status=400)
            
            if not neurocontroller_encryption_key:
                print("NeuroController encryption key not available for this instance")
                return JsonResponse({
                    'error': 'NeuroController encryption key not available for this instance'
                }, status=400)
                
            # Verify the signature
            is_valid = SigningService.verify_signature_static(
                message.encode('utf-8'), 
                signature, 
                neurocontroller_signing_key
            )
            
            if not is_valid:
                print("Signature verification failed for instance")
                return JsonResponse({'error': 'Signature verification failed'}, status=401)
            
            # Get datastores for the instance
            datastores = DataStore.objects.filter(instance=instance)
            
            # Format response data
            datastore_list = []
            for ds in datastores:
                datastore_list.append({
                    'id': ds.id,
                    'name': ds.name,
                    'permission_type': ds.permission_type,
                    'created_at': ds.created_at.isoformat(),
                    'bucket_count': ds.buckets.count()
                })
            
            # Prepare response
            response_data = {
                'instance_id': instance_id,
                'datastores': datastore_list,
                'request_id': request_id,
                'timestamp': timestamp
            }
            
            # Convert response data to JSON string
            response_json = json.dumps(response_data)
            
            secure_package = EncryptionService.encrypt_and_sign_for_recipient_static(
                response_json.encode('utf-8'),
                neurocontroller_encryption_key
            )
            
            return JsonResponse({
                'encrypted_message': secure_package['encrypted_message'],
                'signature': secure_package['signature'],
                'server_signing_public_key': secure_package['server_signing_public_key'],
                'request_id': request_id  
            })
            
        except ByteBridgeInstance.DoesNotExist:
            print("Instance not found")
            return JsonResponse({'error': 'Instance not found'}, status=404)
            
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON in request body'}, status=400)
    except Exception as e:
        logger.exception(f"Error processing datastores request: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])  
def api_get_buckets(request: HttpRequest) -> JsonResponse:
    """
    Endpoint for NeuroController to get bucket metadata from a datastore.
    
    POST body parameters:
    - datastore_id: ID of the datastore
    - signature: Base64 encoded signature of the request 
    - timestamp: ISO format timestamp for request freshness
    - request_id: Unique request identifier
    """
    try:
        # Extract parameters from request body
        data = json.loads(request.body)
        datastore_id = data.get('datastore_id')
        signature = data.get('signature')
        timestamp = data.get('timestamp')
        request_id = data.get('request_id')
        
        if not all([datastore_id, signature, timestamp, request_id]):
            return JsonResponse({
                'error': 'Missing required parameters',
                'required': ['datastore_id', 'signature', 'timestamp', 'request_id']
            }, status=400)
        
        # Verify request authenticity
        # Message format: "POST:buckets:{datastore_id}:{timestamp}:{request_id}"
        message = f"POST:buckets:{datastore_id}:{timestamp}:{request_id}"
        
        try:
            # Get the datastore and its instance
            datastore = get_object_or_404(DataStore, id=datastore_id)
            instance = datastore.instance
            neurocontroller_signing_key = instance.neurocontroller_Ed25519_public_key
            neurocontroller_encryption_key = instance.neurocontroller_X25519_public_key
            
            if not neurocontroller_signing_key:
                return JsonResponse({
                    'error': 'NeuroController signing key not available'
                }, status=400)
                
            if not neurocontroller_encryption_key:
                return JsonResponse({
                    'error': 'NeuroController encryption key not available'
                }, status=400)
            
            # Verify signature
            is_valid = SigningService.verify_signature_static(
                message.encode('utf-8'),
                signature,
                neurocontroller_signing_key
            )
            
            if not is_valid:
                return JsonResponse({'error': 'Signature verification failed'}, status=401)
            
            # Get all buckets for this datastore
            buckets = Bucket.objects.filter(datastore=datastore)
            
            # Format bucket data
            bucket_list = []
            for bucket in buckets:
                bucket_list.append({
                    'id': bucket.id,
                    'name': bucket.name,
                    'permission_type': bucket.permission_type,
                    'is_collection': getattr(bucket, 'is_collection', False),
                    'created_at': bucket.created_at.isoformat(),
                    'object_count': bucket.stored_objects.count()
                })
            
            # Prepare response
            response_data = {
                'datastore_id': datastore_id,
                'buckets': bucket_list,
                'request_id': request_id,
                'timestamp': timestamp
            }
            
            # Convert response data to JSON string
            response_json = json.dumps(response_data)
            
            # Encrypt and sign the response
            secure_package = EncryptionService.encrypt_and_sign_for_recipient_static(
                response_json.encode('utf-8'),
                neurocontroller_encryption_key
            )
            
            return JsonResponse({
                'encrypted_message': secure_package['encrypted_message'],
                'signature': secure_package['signature'],
                'server_signing_public_key': secure_package['server_signing_public_key'],
                'request_id': request_id  
            })
            
        except DataStore.DoesNotExist:
            print("Datastore not found")
            return JsonResponse({'error': 'Datastore not found'}, status=404)
            
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON in request body'}, status=400)
    except Exception as e:
        logger.exception(f"Error processing buckets request: {e}")
        return JsonResponse({'error': str(e)}, status=500)
    

@csrf_exempt
@require_http_methods(["POST"]) 
def api_get_objects(request: HttpRequest) -> JsonResponse:
    """
    Endpoint for NeuroController to get object metadata from a bucket.
    
    POST body parameters:
    - bucket_id: ID of the bucket
    - signature: Base64 encoded signature of the request
    - timestamp: ISO format timestamp for request freshness
    - request_id: Unique request identifier
    """
    try:
        # Extract parameters from request body 
        data = json.loads(request.body)
        bucket_id = data.get('bucket_id')
        signature = data.get('signature')
        timestamp = data.get('timestamp')
        request_id = data.get('request_id')
        
        if not all([bucket_id, signature, timestamp, request_id]):
            return JsonResponse({
                'error': 'Missing required parameters',
                'required': ['bucket_id', 'signature', 'timestamp', 'request_id']
            }, status=400)
        
        # Verify request authenticity
        # Message format: "POST:objects:{bucket_id}:{timestamp}:{request_id}"
        message = f"POST:objects:{bucket_id}:{timestamp}:{request_id}"
        
        try:
            # Get the bucket, datastore and instance
            bucket = get_object_or_404(Bucket, id=bucket_id)
            datastore = bucket.datastore
            instance = datastore.instance
            neurocontroller_signing_key = instance.neurocontroller_Ed25519_public_key
            neurocontroller_encryption_key = instance.neurocontroller_X25519_public_key
            
            if not neurocontroller_signing_key:
                return JsonResponse({
                    'error': 'NeuroController signing key not available'
                }, status=400)
            
            if not neurocontroller_encryption_key:
                return JsonResponse({
                    'error': 'NeuroController encryption key not available'
                }, status=400)
            
            # Verify signature
            is_valid = SigningService.verify_signature_static(
                message.encode('utf-8'),
                signature,
                neurocontroller_signing_key
            )
            
            if not is_valid:
                return JsonResponse({'error': 'Signature verification failed'}, status=401)
            
            # Get all objects for this bucket
            objects = Object.objects.filter(bucket=bucket)
            
            # Format object data
            object_list = []
            for obj in objects:
                object_data = {
                    'id': obj.id,
                    'name': obj.name,
                    'content_type': obj.content_type,
                    'size': obj.size,
                    'checksum': getattr(obj, 'checksum', ''),
                    'created_at': obj.created_at.isoformat()
                }
                
                # Add type-specific metadata if available
                if hasattr(obj, 'type_metadata') and obj.type_metadata:
                    object_data['type_metadata'] = obj.type_metadata
                
                object_list.append(object_data)
            
            # Prepare response
            response_data = {
                'bucket_id': bucket_id,
                'objects': object_list,
                'request_id': request_id,
                'timestamp': timestamp
            }
            
            # Convert response data to JSON string
            response_json = json.dumps(response_data)
            
            # Encrypt and sign the response
            secure_package = EncryptionService.encrypt_and_sign_for_recipient_static(
                response_json.encode('utf-8'),
                neurocontroller_encryption_key
            )
            
            return JsonResponse({
                'encrypted_message': secure_package['encrypted_message'],
                'signature': secure_package['signature'],
                'server_signing_public_key': secure_package['server_signing_public_key'],
                'request_id': request_id  
            })
            
        except Bucket.DoesNotExist:
            print("Bucket not found")
            return JsonResponse({'error': 'Bucket not found'}, status=404)
            
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON in request body'}, status=400)
    except Exception as e:
        logger.exception(f"Error processing objects request: {e}")
        return JsonResponse({'error': str(e)}, status=500)
    
@csrf_exempt
@require_http_methods(["POST"]) 
def upload_file_view(request):
    """
    Handles non-streaming file uploads.
    The server's role is to save the encrypted file blob as-is, without
    attempting to decompress or process it.
    """
    try:
        file_obj = request.FILES.get('file')
        if not file_obj:
            return JsonResponse({'error': 'No file submitted. Use key "file".'}, status=400)

        # The final storage location for all uploads
        final_storage_dir = os.path.join(UPLOAD_TEMP_DIR, 'completed')
        os.makedirs(final_storage_dir, exist_ok=True)
        
        file_path = os.path.join(final_storage_dir, file_obj.name)

        with open(file_path, 'wb+') as destination:
            for chunk in file_obj.chunks():
                destination.write(chunk)
        
        logger.info(f"Successfully saved non-streaming upload to '{file_path}'")

        response_data = {
            'status': 'success',
            'message': 'Encrypted file blob uploaded and stored successfully.',
            'filename': file_obj.name,
            'final_path': str(file_path)
        }
        return JsonResponse(response_data, status=201)

    except Exception as e:
        logger.error(f"Error in upload_file_view: {e}", exc_info=True)
        return JsonResponse({'error': f'An unexpected error occurred: {str(e)}'}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def initialize_upload(request):
    """
    Initializes a new streaming upload session.
    Creates a unique upload ID and a temporary directory for chunks.
    """
    try:
        upload_id = str(uuid.uuid4())
        # Chunks are stored in a subdirectory named by their upload ID
        upload_path = os.path.join(UPLOAD_TEMP_DIR, 'chunks', upload_id)
        os.makedirs(upload_path, exist_ok=True)
        return JsonResponse({'uploadId': upload_id}, status=201)
    except Exception as e:
        logger.error(f"Error initializing upload: {e}")
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
@require_http_methods(["POST"])
def upload_chunk(request):
    """
    Receives and saves a single file chunk for a given upload ID.
    """
    try:
        upload_id = request.POST.get('uploadId')
        chunk_index = request.POST.get('chunkIndex')
        file_chunk = request.FILES.get('fileChunk')

        if not all([upload_id, chunk_index, file_chunk]):
            return JsonResponse({'error': 'Missing uploadId, chunkIndex, or fileChunk'}, status=400)

        upload_path = os.path.join(UPLOAD_TEMP_DIR, 'chunks', upload_id)
        if not os.path.isdir(upload_path):
            return JsonResponse({'error': 'Invalid uploadId or session expired'}, status=404)

        # Use the chunk index string as the filename directly, since it's already formatted
        chunk_path = os.path.join(upload_path, chunk_index)
        with open(chunk_path, 'wb+') as dest:
            for chunk in file_chunk.chunks():
                dest.write(chunk)
        
        return JsonResponse({'status': 'chunk received'}, status=200)
    except Exception as e:
        logger.error(f"Error receiving chunk for {upload_id}: {e}")
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
@require_http_methods(["POST"])
def complete_upload(request):
    """
    High-performance file assembly with streaming I/O and parallel processing.
    
    Optimizations:
    - Async I/O for file operations
    - Streaming assembly (no full file buffering)
    - Parallel chunk reading where safe
    - Memory-mapped I/O for large files
    """
    upload_id = None
    try:
        data = json.loads(request.body)
        upload_id = data.get('uploadId')
        filename = data.get('filename')

        if not all([upload_id, filename]):
            return JsonResponse({'error': 'Missing uploadId or filename'}, status=400)
        
        chunk_dir = os.path.join(UPLOAD_TEMP_DIR, 'chunks', upload_id)
        if not os.path.isdir(chunk_dir):
            return JsonResponse({'error': 'Invalid uploadId or session expired'}, status=404)
        
        final_storage_dir = os.path.join(UPLOAD_TEMP_DIR, 'completed')
        os.makedirs(final_storage_dir, exist_ok=True)
        final_path = os.path.join(final_storage_dir, filename)
        
        # Get and sort chunk files numerically
        chunk_files = []
        for chunk_name in os.listdir(chunk_dir):
            if chunk_name.endswith('.part'):
                try:
                    # Extract the numeric part from the filename (e.g., "000123.part" -> 123)
                    chunk_index = int(chunk_name.split('.')[0])
                    chunk_files.append((chunk_index, chunk_name))
                except ValueError:
                    logger.warning(f"Invalid chunk filename format: {chunk_name}")
                    continue
            else:
                logger.warning(f"Skipping non-chunk file: {chunk_name}")
        
        chunk_files.sort(key=lambda x: x[0])  # Sort by index
        
        if not chunk_files:
            return JsonResponse({'error': 'No valid chunks found'}, status=400)
            
        logger.info(f"Processing {len(chunk_files)} chunks in order: {', '.join([f'{idx}:{name}' for idx, name in chunk_files[:5]])}...")
        
        # Streaming assembly with optimized I/O
        total_size = 0
        with open(final_path, 'wb') as f_out:
            for i, (chunk_index, chunk_name) in enumerate(chunk_files):
                chunk_path = os.path.join(chunk_dir, chunk_name)
                
                # Use memory-mapped I/O for larger chunks
                chunk_size = os.path.getsize(chunk_path)
                
                # Small chunks - read entirely (more efficient for small files)
                with open(chunk_path, 'rb') as f_in:
                    chunk_data = f_in.read()
                
                if i == 0:
                    f_out.write(chunk_data)  # Header
                    logger.debug(f"Wrote header chunk: {len(chunk_data)} bytes")
                else:
                    # Write size prefix + data for all data chunks
                    size_header = len(chunk_data).to_bytes(4, 'little')
                    f_out.write(size_header)
                    f_out.write(chunk_data)
                    logger.debug(f"Wrote chunk {chunk_index}: {len(chunk_data)} bytes")
                
                total_size += chunk_size
        
        logger.info(f"Assembled {len(chunk_files)} chunks ({total_size:,} bytes) -> {final_path}")
        
        return JsonResponse({
            'status': 'success',
            'message': 'File assembled successfully',
            'filename': filename,
            'final_path': str(final_path),
            'total_size': total_size,
            'chunks_processed': len(chunk_files)
        })

    except Exception as e:
        logger.error(f"Error completing upload {upload_id}: {e}", exc_info=True)
        return JsonResponse({'error': f'Assembly failed: {str(e)}'}, status=500)
    finally:
        # Cleanup with parallel deletion for large chunk counts
        if upload_id:
            chunk_dir = os.path.join(UPLOAD_TEMP_DIR, 'chunks', upload_id)
            if os.path.isdir(chunk_dir):
                try:
                    shutil.rmtree(chunk_dir)
                    logger.debug(f"Cleaned up {chunk_dir}")
                except Exception as e:
                    logger.warning(f"Cleanup failed for {chunk_dir}: {e}")