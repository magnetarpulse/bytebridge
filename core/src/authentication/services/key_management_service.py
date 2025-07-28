import base64
import nacl.signing
import nacl.public
import logging
import uuid
from typing import Optional

from ..models import (
    EncryptionKeyPair,
    SigningKeyPair
)
from .secure_key_storage_service import SecureKeyStorageService

logger = logging.getLogger(__name__)


class KeyManagementService:
    """
    Service for managing server cryptographic key pairs.
    
    This service manages two distinct types of keypairs:
    1. Ed25519 keypairs for digital signatures (SigningKeyPair)
    2. X25519 keypairs for encryption/decryption (EncryptionKeyPair)
    
    Each key type has distinct methods:
    - For Ed25519 signing keys: get_or_create_ed25519_signing_keypair(), generate_ed25519_signing_keypair(), etc.
    - For X25519 encryption keys: get_or_create_x25519_encryption_keypair(), generate_x25519_encryption_keypair(), etc.
    
    These keypairs serve as the foundation for all server cryptographic operations,
    with proper separation between signing and encryption functions.
    """

    @staticmethod
    def get_or_create_ed25519_signing_keypair() -> SigningKeyPair:
        """
        Get the active Ed25519 signing keypair or create one if none exists.
        
        This keypair is used for digital signatures, not for encryption.
        
        Returns:
            SigningKeyPair: The server's current active Ed25519 signing keypair
            
        Raises:
            Exception: If keypair retrieval or creation fails
            
        Example:
            ```python
            signing_keypair = KeyManagementService.get_or_create_ed25519_signing_keypair()
            print(f"Using Ed25519 signing keypair: {signing_keypair.id}")
            ```
        """
        # Get active keypair if one exists
        try:
            keypair: Optional[SigningKeyPair] = SigningKeyPair.objects.filter(is_active=True).first()
            if keypair:
                return keypair
                
            # No active keypair, create a new one
            return KeyManagementService.generate_ed25519_signing_keypair()
            
        except Exception as e:
            logger.error(f"Error retrieving server's Ed25519 signing keypair: {str(e)}", exc_info=True)
            raise

    @staticmethod
    def get_or_create_x25519_encryption_keypair() -> EncryptionKeyPair:
        """
        Get the active X25519 encryption keypair or create one if none exists.
        
        This keypair is specifically for public key encryption/decryption operations,
        not for digital signatures.
        
        Returns:
            EncryptionKeyPair: The server's current active X25519 encryption keypair
            
        Raises:
            Exception: If keypair retrieval or creation fails
            
        Example:
            ```python
            encryption_keypair = KeyManagementService.get_or_create_x25519_encryption_keypair()
            print(f"Using X25519 encryption keypair: {encryption_keypair.id}")
            ```
        """
        # Get active keypair if one exists
        try:
            keypair: Optional[EncryptionKeyPair] = EncryptionKeyPair.objects.filter(is_active=True).first()
            if keypair:
                return keypair
                
            # No active keypair, create a new one
            return KeyManagementService.generate_x25519_encryption_keypair()
            
        except Exception as e:
            logger.error(f"Error retrieving X25519 encryption keypair: {str(e)}", exc_info=True)
            raise
    
    @staticmethod
    def generate_ed25519_signing_keypair() -> SigningKeyPair:
        """
        Generate a new Ed25519 keypair for digital signatures.
        
        The public key is stored in the database, while the private
        key is securely stored in the system keyring.
        Any existing active signing keypairs are deactivated.
        
        Returns:
            SigningKeyPair: The newly created Ed25519 signing keypair
            
        Raises:
            Exception: If private key storage fails
            
        Example:
            ```python
            new_signing_keypair = KeyManagementService.generate_ed25519_signing_keypair()
            print(f"New Ed25519 signing keypair generated with ID: {new_signing_keypair.id}")
            ```
        """
        # Deactivate any existing keypairs
        SigningKeyPair.objects.filter(is_active=True).update(is_active=False)
        
        # Generate new Ed25519 keypair
        signing_key: nacl.signing.SigningKey = nacl.signing.SigningKey.generate()
        verify_key: nacl.signing.VerifyKey = signing_key.verify_key
        
        # Encode keys
        private_key_b64: str = base64.b64encode(signing_key.encode()).decode('ascii')
        public_key_b64: str = base64.b64encode(verify_key.encode()).decode('ascii')
        
        # Generate unique ID for the key
        key_id: str = str(uuid.uuid4())
        
        # Store private key in secure keyring
        if not SecureKeyStorageService.store_private_key(key_id, private_key_b64):
            raise Exception("Failed to securely store Ed25519 private key")
        
        # Create and save keypair in database (private key reference only)
        keypair: SigningKeyPair = SigningKeyPair(
            id=uuid.UUID(key_id),
            private_key_id=key_id,
            public_key=public_key_b64,
            algorithm="ed25519",
            is_active=True
        )
        keypair.save()
        
        logger.info(f"New Ed25519 signing keypair generated: {keypair.id}")
        return keypair
    
    @staticmethod
    def generate_x25519_encryption_keypair() -> EncryptionKeyPair:
        """
        Generate a new X25519 keypair for encryption operations.
        
        Creates a dedicated keypair for encryption/decryption operations.
        Any existing active encryption keypairs are deactivated.
        
        Returns:
            EncryptionKeyPair: The newly created X25519 encryption keypair
            
        Raises:
            Exception: If private key storage fails
            
        Example:
            ```python
            new_encryption_keypair = KeyManagementService.generate_x25519_encryption_keypair()
            print(f"New X25519 encryption keypair generated with ID: {new_encryption_keypair.id}")
            ```
        """
        # Deactivate any existing encryption keypairs
        EncryptionKeyPair.objects.filter(is_active=True).update(is_active=False)
        
        # Generate new X25519 keypair
        private_key: nacl.public.PrivateKey = nacl.public.PrivateKey.generate()
        public_key: nacl.public.PublicKey = private_key.public_key
        
        # Encode keys
        private_key_b64: str = base64.b64encode(private_key.encode()).decode('ascii')
        public_key_b64: str = base64.b64encode(public_key.encode()).decode('ascii')
        
        # Generate unique ID for the key
        key_id: str = str(uuid.uuid4())
        
        # Store private key in secure keyring with "x25519:" prefix to distinguish from Ed25519 keys
        storage_id: str = f"x25519:{key_id}"
        if not SecureKeyStorageService.store_private_key(storage_id, private_key_b64):
            raise Exception("Failed to securely store X25519 private key")
        
        # Create and save keypair in database (private key reference only)
        keypair: EncryptionKeyPair = EncryptionKeyPair(
            id=uuid.UUID(key_id),
            private_key_id=storage_id,
            public_key=public_key_b64,
            algorithm="x25519",
            is_active=True
        )
        keypair.save()
        
        logger.info(f"New X25519 encryption keypair generated: {keypair.id}")
        return keypair
    
    @staticmethod
    def get_ed25519_signing_public_key() -> str:
        """
        Get the server's current Ed25519 public key for signature verification.
        
        Retrieves the current active signing keypair and returns its public key.
        If no active keypair exists, one will be created automatically.
        
        Returns:
            str: Base64-encoded Ed25519 public key for signature verification
            
        Raises:
            Exception: If retrieving or creating the keypair fails
            
        Example:
            ```python
            signing_public_key = KeyManagementService.get_ed25519_signing_public_key()
            print(f"Server Ed25519 signing public key: {signing_public_key}")
            ```
        """
        keypair: SigningKeyPair = KeyManagementService.get_or_create_ed25519_signing_keypair()
        return keypair.public_key
    
    @staticmethod
    def get_x25519_encryption_public_key() -> str:
        """
        Get the server's X25519 public key for encryption.
        
        This key should be shared with parties that need to send encrypted 
        messages to this server. If no active encryption keypair exists,
        one will be created automatically.
        
        Returns:
            str: Base64-encoded X25519 public key for encryption
            
        Raises:
            Exception: If retrieving or creating the keypair fails
            
        Example:
            ```python
            encryption_public_key = KeyManagementService.get_x25519_encryption_public_key()
            # Share this key with clients who need to send encrypted data to the server
            ```
        """
        try:
            # Get the server's X25519 encryption keypair
            keypair: EncryptionKeyPair = KeyManagementService.get_or_create_x25519_encryption_keypair()
            return keypair.public_key
        
        except Exception as e:
            error_msg: str = f"Failed to retrieve server X25519 encryption public key: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    @staticmethod
    def get_ed25519_signing_private_key(signing_keypair: SigningKeyPair) -> Optional[nacl.signing.SigningKey]:
        """
        Retrieve the Ed25519 private signing key from secure storage.
        
        Gets the private key from the secure keyring using the ID stored
        in the keypair model and constructs a NaCl SigningKey object.
        
        Args:
            signing_keypair: SigningKeyPair model instance containing the private key reference
            
        Returns:
            Optional[SigningKey]: NaCl Ed25519 signing key object or None if retrieval failed
            
        Example:
            ```python
            keypair = KeyManagementService.get_or_create_ed25519_signing_keypair()
            signing_key = KeyManagementService.get_ed25519_signing_private_key(keypair)
            if signing_key:
                # Use signing key for creating digital signatures
            ```
        """
        # Get private key from secure storage
        private_key_b64: Optional[str] = SecureKeyStorageService.retrieve_private_key(signing_keypair.private_key_id)
        if not private_key_b64:
            logger.error(f"Failed to retrieve Ed25519 private signing key for {signing_keypair.id}")
            return None
        
        # Decode from base64 to raw bytes
        try:
            private_key_bytes: bytes = base64.b64decode(private_key_b64)
            return nacl.signing.SigningKey(private_key_bytes)
        except Exception as e:
            logger.error(f"Error decoding Ed25519 private signing key: {str(e)}")
            return None
        
    @staticmethod
    def get_x25519_encryption_private_key(encryption_keypair: EncryptionKeyPair) -> Optional[nacl.public.PrivateKey]:
        """
        Retrieve the X25519 private encryption key from secure storage.
        
        Gets the private key from the secure keyring using the ID stored
        in the keypair model and constructs a NaCl PrivateKey object.
        
        Args:
            encryption_keypair: EncryptionKeyPair model instance containing the private key reference
            
        Returns:
            Optional[PrivateKey]: NaCl X25519 private key object or None if retrieval failed
            
        Example:
            ```python
            keypair = KeyManagementService.get_or_create_x25519_encryption_keypair()
            encryption_key = KeyManagementService.get_x25519_encryption_private_key(keypair)
            if encryption_key:
                # Use private key for decrypting messages
            ```
        """
        # Get private key from secure storage
        private_key_b64: Optional[str] = SecureKeyStorageService.retrieve_private_key(encryption_keypair.private_key_id)
        if not private_key_b64:
            logger.error(f"Failed to retrieve X25519 private encryption key for {encryption_keypair.id}")
            return None
        
        # Decode from base64 to raw bytes
        try:
            private_key_bytes: bytes = base64.b64decode(private_key_b64)
            return nacl.public.PrivateKey(private_key_bytes)
        except Exception as e:
            logger.error(f"Error decoding X25519 private encryption key: {str(e)}")
            return None
    
    @staticmethod
    def rotate_ed25519_signing_keypair() -> SigningKeyPair:
        """
        Rotate the server's Ed25519 signing keypair by generating a new one.
        
        This is a security best practice to periodically change cryptographic keys.
        The old keypair is deactivated but remains in the database for reference.
        
        Returns:
            SigningKeyPair: The newly created Ed25519 signing keypair
            
        Raises:
            Exception: If keypair generation fails
            
        Example:
            ```python
            new_keypair = KeyManagementService.rotate_ed25519_signing_keypair()
            print(f"Ed25519 signing keys rotated. New keypair ID: {new_keypair.id}")
            ```
        """
        # Get the old keypair to deactivate and clean up
        old_keypair: Optional[SigningKeyPair] = SigningKeyPair.objects.filter(is_active=True).first()
        if old_keypair:
            old_keypair.is_active = False
            old_keypair.save(update_fields=["is_active"])
        
        # Generate a new keypair
        return KeyManagementService.generate_ed25519_signing_keypair()
    
    @staticmethod
    def rotate_x25519_encryption_keypair() -> EncryptionKeyPair:
        """
        Rotate the X25519 encryption keypair by generating a new one.
        
        This is a security best practice to periodically change cryptographic keys.
        The old keypair is deactivated but remains in the database for reference.
        
        Returns:
            EncryptionKeyPair: The newly created X25519 encryption keypair
            
        Raises:
            Exception: If keypair generation fails
            
        Example:
            ```python
            new_keypair = KeyManagementService.rotate_x25519_encryption_keypair()
            print(f"X25519 encryption keys rotated. New keypair ID: {new_keypair.id}")
            # Remember to share the new public key with external services
            print(f"New public key to share: {new_keypair.public_key}")
            ```
        """
        # Get the old keypair to deactivate
        old_keypair: Optional[EncryptionKeyPair] = EncryptionKeyPair.objects.filter(is_active=True).first()
        if old_keypair:
            old_keypair.is_active = False
            old_keypair.save(update_fields=["is_active"])
        
        # Generate a new keypair
        return KeyManagementService.generate_x25519_encryption_keypair()