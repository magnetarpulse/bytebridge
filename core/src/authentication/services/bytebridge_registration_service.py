import base64
import requests
import logging
import time
from typing import Dict, Any, Optional, Tuple, Union
from django.conf import settings

from core.models import ByteBridgeInstance
from .key_management_service import KeyManagementService
from .signing_service import SigningService

logger = logging.getLogger(__name__)


class ByteBridgeRegistrationService:
    """
    Service for registering ByteBridge with NeuroController.
    
    This service handles the secure registration flow between ByteBridge instances
    and the NeuroController system, including:
    - Key-based authentication using public-key cryptography
    - Challenge-response protocol for secure authentication
    - 2FA verification flow when required by NeuroController
    - Persistent registration status management
    
    The service establishes a trusted connection between ByteBridge and
    NeuroController by exchanging and verifying public keys, enabling secure
    communication between the two systems after registration.
    """
    
    def __init__(self):
        """
        Initialize the registration service with NeuroController API URL.
        
        The service uses KeyManagementService for keypair operations and 
        SigningService for cryptographic signing operations required
        during the registration process.
        """
        self.base_url: str = settings.NEUROCONTROLLER_URL
        self.key_management_service: KeyManagementService = KeyManagementService()
        self.signing_service: SigningService = SigningService(self.key_management_service)
    
    def register_instance(self, instance: ByteBridgeInstance) -> Tuple[bool, Optional[str]]:
        """
        Register a ByteBridge instance with NeuroController.
        
        This method handles the complete registration flow, including:
        1. Retrieving or generating server keypair
        2. Getting an authentication challenge from NeuroController
        3. Signing the challenge with the private key
        4. Submitting registration data with the signature
        5. Handling 2FA if required
        6. Storing the NeuroController's public key upon successful registration
        
        Args:
            instance: ByteBridgeInstance to register with NeuroController
            
        Returns:
            Tuple[bool, Optional[str]]: (success_flag, error_message)
                - success_flag: True if registration was successful
                - error_message: None if successful, otherwise error explanation
        
        Raises:
            Exception: If an unexpected error occurs during registration
            
        Example:
            ```python
            service = ByteBridgeRegistrationService()
            instance = ByteBridgeInstance.objects.get(id=1)
            success, error = service.register_instance(instance)
            
            if success:
                print("Registration successful!")
            else:
                print(f"Registration failed: {error}")
            ```
        """
        try:
            signing_keypair = self.key_management_service.get_or_create_ed25519_signing_keypair()
            signing_key = self.key_management_service.get_ed25519_signing_private_key(signing_keypair)
            encryption_keypair = self.key_management_service.get_or_create_x25519_encryption_keypair()
            encryption_key = self.key_management_service.get_ed25519_signing_private_key(encryption_keypair)
            
            if not signing_key or not encryption_key:
                return False, "Failed to retrieve server private keys"
            
            token_id: str = settings.NEUROCONTROLLER_TOKEN_ID
            if not token_id:
                return False, "Missing NEUROCONTROLLER_TOKEN_ID in settings"
            
            logger.info(f"Getting authentication challenge for token ID: {token_id}")
            challenge_response: Optional[Dict[str, Any]] = self._get_authentication_challenge(token_id)
            if not challenge_response:
                return False, "Failed to get authentication challenge"
            
            challenge_id: str = challenge_response.get("challenge_id")
            challenge_hash: str = challenge_response.get("challenge_hash")
            
            logger.info(f"Got challenge ID: {challenge_id}")
            logger.info(f"Challenge hash: {challenge_hash}")
            
            challenge_hash_bytes: bytes = base64.b64decode(challenge_hash)
            signature: str = self.signing_service.sign_message(challenge_hash_bytes)[0]
            
            register_endpoint: str = f"{self.base_url}/api/register/bytebridge/"
            
            permission_type = getattr(instance, 'permission_type', 'private')
            logger.info(f"Using permission type: {permission_type} for instance: {instance.name}")
            
            data: Dict[str, Union[str, int]] = {
                "token_id": token_id,
                "challenge_id": challenge_id,
                "signature": signature,
                "name": instance.name,
                "host": settings.API_HOST,
                "port": int(settings.API_PORT),
                "description": instance.description or "",
                "instance_identifier": str(instance.instance_identifier),
                "signing_key": signing_keypair.public_key,
                "encryption_key": encryption_keypair.public_key,
                "permission_type": permission_type,  
            }
            
            logger.info(f"Sending registration request to {register_endpoint}")
            logger.info(f"Registration payload (excluding signature): {data}")
            
            headers: Dict[str, str] = {'Content-Type': 'application/json'}
            response: requests.Response = requests.post(
                register_endpoint,
                json=data,
                headers=headers,
                timeout=30
            )
            
            logger.info(f"Registration response status: {response.status_code}")
            logger.info(f"Registration response headers: {response.headers}")
            logger.info(f"Registration response body: {response.text[:500]}")
            
            if response.status_code == 200:
                result: Dict[str, Any] = response.json()
                logger.info(f"ByteBridge instance registered successfully: {instance.name}")
                print("ByteBridge instance registered successfully")
    
                print("Registration response:", result)
                
                if result.get('public_signing_key'):
                    instance.neurocontroller_Ed25519_public_key = result['public_signing_key']
                    instance.is_registered = True
                    instance.save(update_fields=['neurocontroller_Ed25519_public_key', 'is_registered'])
    
                if result.get('public_encryption_key'):
                    instance.neurocontroller_X25519_public_key = result['public_encryption_key']
                    instance.save(update_fields=['neurocontroller_X25519_public_key'])
                
                return True, None
            
            elif response.status_code == 202:
                result: Dict[str, Any] = response.json()
                if result.get('requires_2fa') and result.get('request_id'):
                    return self._handle_2fa_verification(response, register_endpoint, data, instance)
            
            error_msg: str = f"Registration failed with status code {response.status_code}"
            try:
                error_details: Dict[str, Any] = response.json()
                error_msg += f": {error_details}"
            except:
                error_msg += f": {response.text}"
            
            logger.error(error_msg)
            return False, error_msg
            
        except Exception as e:
            logger.exception(f"Error during ByteBridge registration: {e}")
            return False, f"Registration error: {str(e)}"
        
    def _get_authentication_challenge(self, token_id: str) -> Optional[Dict[str, Any]]:
        """
        Get an authentication challenge from NeuroController.
        
        This method requests a cryptographic challenge from the NeuroController
        to use in the challenge-response authentication protocol. The challenge
        involves a randomly generated token that must be signed to prove
        possession of the private key.
        
        The challenge API expects:
        {
            "token_id": str  # The token identifier requiring authentication
        }
        
        Args:
            token_id: API token ID registered with NeuroController
            
        Returns:
            Optional[Dict[str, Any]]: Challenge data including challenge_id and 
                                     challenge_hash, or None if request failed
                                     
        Example:
            ```python
            service = ByteBridgeRegistrationService()
            token_id = "a1b2c3d4"
            challenge = service._get_authentication_challenge(token_id)
            if challenge:
                challenge_id = challenge.get("challenge_id")
                challenge_hash = challenge.get("challenge_hash")
            ```
        """
        challenge_endpoint: str = f"{self.base_url}/api/auth/challenge"
        
        try:
            payload: Dict[str, str] = {
                "token_id": token_id
            }
            
            logger.info(f"Requesting challenge from {challenge_endpoint}")
            logger.info(f"Request payload: {payload}")
            
            response: requests.Response = requests.post(
                challenge_endpoint, 
                json=payload,  
                headers={'Content-Type': 'application/json'},  
                timeout=10
            )
            
            logger.info(f"Challenge response status: {response.status_code}")
            logger.info(f"Challenge response headers: {response.headers}") 
            
            if response.status_code == 200:
                challenge_data: Dict[str, Any] = response.json()
                if all(k in challenge_data for k in ['challenge_id', 'challenge_data', 'challenge_hash']):
                    return challenge_data
                else:
                    logger.error(f"Challenge response missing required fields: {challenge_data}")
                    return None
            else:
                logger.error(f"Failed to get challenge: {response.status_code} {response.text}")
                return None
        
        except Exception as e:
            logger.exception(f"Error getting authentication challenge: {e}")
            return None
    
    def _handle_2fa_verification(
        self, 
        response: requests.Response, 
        endpoint: str, 
        data: Dict[str, Union[str, int]], 
        instance: ByteBridgeInstance, 
        timeout: int = 900, 
        interval: int = 2
    ) -> Tuple[bool, Optional[str]]:
        """
        Handle 2FA verification flow for registration.
        
        This method manages the Two-Factor Authentication flow when required by
        NeuroController. It continuously polls the 2FA status endpoint until
        the verification is either completed, rejected, or times out.
        
        The flow consists of:
        1. Extracting the request_id from the initial response
        2. Polling the 2FA status endpoint at regular intervals
        3. Upon 2FA approval, getting a fresh challenge and making a second registration attempt
        4. Handling the final registration response
        
        Args:
            response: Initial response requiring 2FA
            endpoint: Original registration endpoint
            data: Registration data from the initial request
            instance: ByteBridgeInstance being registered
            timeout: Maximum polling time in seconds (default: 900)
            interval: Polling interval in seconds (default: 2)
            
        Returns:
            Tuple[bool, Optional[str]]: (success_flag, error_message)
                - success_flag: True if 2FA verification and registration succeeded
                - error_message: None if successful, otherwise error explanation
                
        Example:
            ```python
            # This method is typically called internally from register_instance
            # when a 2FA challenge is issued by the server
            
            initial_response = requests.post(registration_endpoint, json=data)
            if initial_response.status_code == 202:
                result = initial_response.json()
                if result.get('requires_2fa') and result.get('request_id'):
                    success, error = service._handle_2fa_verification(
                        initial_response, 
                        registration_endpoint,
                        registration_data,
                        instance
                    )
            ```
        """
        try:
            result: Dict[str, Any] = response.json()
            request_id: Optional[str] = result.get('request_id')
            
            if not request_id:
                return False, "Missing request_id for 2FA verification"
            
            logger.info(f"2FA verification required for registration. Request ID: {request_id}")
            
            token_id: str = str(data['token_id'])
            poll_url: str = f"{self.base_url}/api/mfa/status/{request_id}/"
            
            start_time: float = time.time()
            while time.time() - start_time < timeout:
                time.sleep(interval)
                
                try:
                    poll_response: requests.Response = requests.get(poll_url, timeout=10)
                    
                    logger.info(f"2FA status poll response: {poll_response.status_code} {poll_response.text[:100]}")
                    
                    if poll_response.status_code == 200:
                        poll_result: Dict[str, Any] = poll_response.json()
                        status: str = poll_result.get('status')
                        
                        if status == 'approved':
                            approval_token: str = poll_result.get('approval_token')
                            
                            logger.info(f"2FA approved. Getting fresh challenge for second attempt")
                            
                            challenge_response: Optional[Dict[str, Any]] = self._get_authentication_challenge(token_id)
                            if not challenge_response:
                                return False, "Failed to get fresh challenge after 2FA approval"
                            
                            challenge_id: str = challenge_response.get("challenge_id")
                            challenge_hash: str = challenge_response.get("challenge_hash")
                            
                            logger.info(f"Got fresh challenge ID: {challenge_id}")
                            logger.info(f"Fresh challenge hash: {challenge_hash}")
                            
                            challenge_hash_bytes: bytes = base64.b64decode(challenge_hash)
                            signature: str = self.signing_service.sign_message(challenge_hash_bytes)[0]
                            
                            second_attempt_data: Dict[str, Union[str, int]] = data.copy()  
                            second_attempt_data.update({
                                "challenge_id": challenge_id,  
                                "signature": signature,        
                                "approval_token": approval_token,
                                "request_id": request_id
                            })
                            
                            logger.info(f"Sending second registration attempt with fresh challenge and approval token")
                            
                            final_response: requests.Response = requests.post(
                                endpoint, 
                                json=second_attempt_data, 
                                headers={'Content-Type': 'application/json'},
                                timeout=30
                            )
                            
                            logger.info(f"Final registration response: {final_response.status_code} {final_response.text[:100]}")
                            
                            if final_response.status_code == 200:
                                logger.info("ByteBridge registration successful after 2FA approval")
                                
                                result: Dict[str, Any] = final_response.json()

                                if result.get('public_signing_key'):
                                    instance.neurocontroller_Ed25519_public_key = result['public_signing_key']
                                    instance.is_registered = True
                                    instance.save(update_fields=['neurocontroller_Ed25519_public_key', 'is_registered'])

                                if result.get('public_encryption_key'):
                                    instance.neurocontroller_X25519_public_key = result['public_encryption_key']
                                    instance.save(update_fields=['neurocontroller_X25519_public_key'])
                                
                                return True, None
                            else:
                                error_msg: str = f"Registration failed after 2FA approval: {final_response.status_code} {final_response.text}"
                                logger.error(error_msg)
                                return False, error_msg
                        
                        elif status == 'rejected':
                            return False, "2FA verification rejected by user"
                        
                        elif status == 'expired':
                            return False, "2FA verification request expired"
                    
                except Exception as e:
                    logger.error(f"Error polling for 2FA approval: {e}")
            
            return False, f"2FA verification timed out after {timeout} seconds"
        
        except Exception as e:
            logger.exception(f"Error handling 2FA verification: {e}")
            return False, f"2FA verification error: {str(e)}"