import base64
import nacl.signing
import logging
from typing import Tuple, Optional

from .key_management_service import KeyManagementService

logger = logging.getLogger(__name__)


class SigningService:
    """
    Service for cryptographic signing and signature verification.
    
    This service is responsible for:
    - Signing messages with the server's Ed25519 private signing key
    - Verifying signatures from both the server and external parties
    - Implementing signature-based authentication protocols
    
    The service relies on KeyManagementService for accessing the Ed25519 keypairs
    needed for cryptographic operations.
    """
    
    def __init__(self, key_management_service: Optional[KeyManagementService] = None):
        """
        Initialize the signing service.
        
        Args:
            key_management_service: Optional KeyManagementService instance. If not provided,
                        the static methods of KeyManagementService will be used.
        """
        self.key_management_service: Optional[KeyManagementService] = key_management_service
    
    def sign_message(self, message: bytes) -> Tuple[str, str]:
        """
        Sign a message using the server's Ed25519 private signing key.
        
        Uses the current active Ed25519 keypair to sign a message, producing a
        cryptographic signature that can be verified using the server's public key.
        
        Args:
            message: Bytes to sign
            
        Returns:
            Tuple[str, str]: (signature, ed25519_public_key) both base64 encoded
            
        Raises:
            Exception: If private key cannot be retrieved or signing fails
            
        Example:
            ```python
            service = SigningService()
            message = b"Hello, world!"
            signature, ed25519_public_key = service.sign_message(message)
            print(f"Signature: {signature}")
            ```
        """
        # Get server Ed25519 signing keypair
        if self.key_management_service:
            signing_keypair = self.key_management_service.get_or_create_ed25519_signing_keypair()
            signing_key = self.key_management_service.get_ed25519_signing_private_key(signing_keypair)
        else:
            signing_keypair = KeyManagementService.get_or_create_ed25519_signing_keypair()
            signing_key = KeyManagementService.get_ed25519_signing_private_key(signing_keypair)
        
        if not signing_key:
            raise Exception("Failed to retrieve server Ed25519 signing private key")
        
        # Sign the message
        signature: nacl.signing.SignedMessage = signing_key.sign(message)
        signature_b64: str = base64.b64encode(signature.signature).decode('ascii')
        
        return signature_b64, signing_keypair.public_key
    
    def verify_server_signature(self, message: bytes, signature_b64: str) -> bool:
        """
        Verify if a signature was created by this server.
        
        Useful for validating that a message was signed by this server instance,
        typically for server-to-server authentication.
        
        Args:
            message: The original message that was signed
            signature_b64: Base64-encoded Ed25519 signature
            
        Returns:
            bool: True if signature is valid (created by this server), False otherwise
            
        Example:
            ```python
            service = SigningService()
            message = b"Server authentication token"
            is_valid = service.verify_server_signature(
                message, 
                signature_from_another_system
            )
            ```
        """
        try:
            # Get the server's Ed25519 public key
            if self.key_management_service:
                signing_keypair = self.key_management_service.get_or_create_ed25519_signing_keypair()
            else:
                signing_keypair = KeyManagementService.get_or_create_ed25519_signing_keypair()
                
            ed25519_public_key_b64: str = signing_keypair.public_key
            
            # Decode the public key and signature
            ed25519_public_key_bytes: bytes = base64.b64decode(ed25519_public_key_b64)
            signature_bytes: bytes = base64.b64decode(signature_b64)
            
            # Create verify key
            verify_key: nacl.signing.VerifyKey = nacl.signing.VerifyKey(ed25519_public_key_bytes)
            
            # Verify the signature
            verify_key.verify(message, signature_bytes)
            return True
        except Exception as e:
            logger.warning(f"Server signature verification failed: {str(e)}")
            return False
        
    def verify_signature(self, message: bytes, signature_b64: str, 
                        ed25519_public_key_b64: str) -> bool:
        """
        Verify a signature using the provided Ed25519 public key.
        
        Used to verify signatures from external parties where the
        Ed25519 public key is provided along with the signature.
        
        Args:
            message: The original message that was signed
            signature_b64: Base64-encoded Ed25519 signature
            ed25519_public_key_b64: Base64-encoded Ed25519 public key of the signer
            
        Returns:
            bool: True if signature is valid, False otherwise
            
        Example:
            ```python
            service = SigningService()
            message = b"Important data"
            is_valid = service.verify_signature(
                message,
                client_signature,
                client_ed25519_public_key  # Client's Ed25519 signing key, not X25519 encryption key
            )
            ```
        """
        try:
            # Decode the public key and signature
            ed25519_public_key_bytes: bytes = base64.b64decode(ed25519_public_key_b64)
            signature_bytes: bytes = base64.b64decode(signature_b64)
            
            # Create verify key
            verify_key: nacl.signing.VerifyKey = nacl.signing.VerifyKey(ed25519_public_key_bytes)
            
            # Verify the signature
            verify_key.verify(message, signature_bytes)
            return True
        except Exception as e:
            logger.warning(f"Signature verification failed: {str(e)}")
            return False
    
    @staticmethod
    def sign_message_static(message: bytes) -> Tuple[str, str]:
        """
        Static version of sign_message.
        
        Args:
            message: Bytes to sign
            
        Returns:
            Tuple[str, str]: (signature, ed25519_public_key) both base64 encoded
            
        Raises:
            Exception: If private key cannot be retrieved or signing fails
            
        Example:
            ```python
            message = b"Hello, world!"
            signature, ed25519_public_key = SigningService.sign_message_static(message)
            print(f"Signature: {signature}")
            ```
        """
        service = SigningService()
        return service.sign_message(message)
    
    @staticmethod
    def verify_server_signature_static(message: bytes, signature_b64: str) -> bool:
        """
        Static version of verify_server_signature.
        
        Args:
            message: The original message that was signed
            signature_b64: Base64-encoded Ed25519 signature
            
        Returns:
            bool: True if signature is valid, False otherwise
            
        Example:
            ```python
            message = b"Server authentication token"
            is_valid = SigningService.verify_server_signature_static(
                message, 
                signature_from_another_system
            )
            ```
        """
        service = SigningService()
        return service.verify_server_signature(message, signature_b64)
    
    @staticmethod
    def verify_signature_static(message: bytes, signature_b64: str, ed25519_public_key_b64: str) -> bool:
        """
        Static version of verify_signature.
        
        Args:
            message: The original message that was signed
            signature_b64: Base64-encoded Ed25519 signature
            ed25519_public_key_b64: Base64-encoded Ed25519 public key of the signer
            
        Returns:
            bool: True if signature is valid, False otherwise
            
        Example:
            ```python
            message = b"Important data"
            is_valid = SigningService.verify_signature_static(
                message,
                client_signature,
                client_ed25519_public_key
            )
            ```
        """
        service = SigningService()
        return service.verify_signature(message, signature_b64, ed25519_public_key_b64)