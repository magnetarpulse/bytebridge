import base64
import nacl.public
import nacl.secret
import nacl.utils
import nacl.exceptions
import logging
from typing import Optional, Dict

from .key_management_service import KeyManagementService
from .signing_service import SigningService

logger = logging.getLogger(__name__)


class EncryptionService:
    """
    Service for encryption and decryption of sensitive data.
    
    This service is responsible for:
    - Encrypting messages for specific recipients using X25519 public key cryptography
    - Decrypting messages sent to the server
    - Combining encryption with signing for secure communication
    
    The service uses a hybrid encryption scheme:
    - X25519 for key exchange
    - XChaCha20-Poly1305 via NaCl's Aead for authenticated encryption
    - Ed25519 for message signing when needed
    
    This provides confidentiality for sensitive communications while maintaining 
    message integrity and authenticity.
    """
    
    def __init__(self, key_management_service: Optional[KeyManagementService] = None, 
                signing_service: Optional[SigningService] = None):
        """
        Initialize the encryption service.
        
        Args:
            key_management_service: Optional KeyManagementService instance. If not provided,
                        the static methods of KeyManagementService will be used.
            signing_service: Optional SigningService instance. If not provided,
                        a new instance will be created.
        """
        self.key_management_service: Optional[KeyManagementService] = key_management_service
        self.signing_service: SigningService = signing_service or SigningService(key_management_service)
    
    def encrypt_for_recipient(self, message: bytes, recipient_x25519_public_key_b64: str) -> str:
        """
        Encrypt a message so only the recipient with the corresponding X25519 private key can read it.
        
        Uses a hybrid encryption scheme:
        1. Generate a random symmetric key
        2. Encrypt the message with XChaCha20-Poly1305 using the symmetric key
        3. Encrypt the symmetric key with the recipient's X25519 public key
        4. Combine the encrypted key and encrypted message
        
        Args:
            message: The bytes to encrypt
            recipient_x25519_public_key_b64: Base64-encoded X25519 public key of the recipient.
                                            This must be an X25519 encryption key, not an Ed25519 signing key.
                
        Returns:
            str: Base64-encoded encrypted message
            
        Raises:
            Exception: If encryption fails
            
        Example:
            ```python
            service = EncryptionService()
            message = b"Confidential information"
            
            # The recipient's X25519 encryption public key (not an Ed25519 signing key)
            recipient_encryption_key = "..."  
            
            encrypted = service.encrypt_for_recipient(message, recipient_encryption_key)
            # Send encrypted data to recipient
            ```
        """
        try:
            # Decode recipient's public key
            recipient_public_key_bytes: bytes = base64.b64decode(recipient_x25519_public_key_b64)
            recipient_key: nacl.public.PublicKey = nacl.public.PublicKey(recipient_public_key_bytes)
            
            # Generate random symmetric key
            symmetric_key: bytes = nacl.utils.random(nacl.secret.Aead.KEY_SIZE)
            
            # Encrypt the symmetric key with recipient's public key
            sealed_box: nacl.public.SealedBox = nacl.public.SealedBox(recipient_key)
            encrypted_key: bytes = sealed_box.encrypt(symmetric_key)
            
            # Use Aead to encrypt the message with XChaCha20-Poly1305
            aead_box: nacl.secret.Aead = nacl.secret.Aead(symmetric_key)
            # Additional authenticated data (AAD) for integrity
            aad: bytes = b"NeuroController_aead_v1"  
            encrypted_message: bytes = aead_box.encrypt(message, aad)
            
            # Format: len(encrypted_key)(4) + encrypted_key + encrypted_message
            key_length: bytes = len(encrypted_key).to_bytes(4, byteorder='big')
            combined: bytes = key_length + encrypted_key + encrypted_message
            
            # Return as base64 string
            return base64.b64encode(combined).decode('ascii')
            
        except Exception as e:
            error_msg: str = f"Failed to encrypt message: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def decrypt_from_sender(self, encrypted_message_b64: str) -> bytes:
        """
        Decrypt a message that was encrypted with the server's X25519 public key.
        
        Uses the hybrid decryption scheme:
        1. Extract the encrypted symmetric key
        2. Decrypt the symmetric key with the server's X25519 private key
        3. Use the symmetric key to decrypt the message with XChaCha20-Poly1305
        
        Args:
            encrypted_message_b64: Base64-encoded encrypted message
            
        Returns:
            bytes: The decrypted message
            
        Raises:
            Exception: If decryption fails or server keys cannot be retrieved
            
        Example:
            ```python
            service = EncryptionService()
            encrypted_data = "..."  # Base64-encoded encrypted message
            decrypted = service.decrypt_from_sender(encrypted_data)
            # Process the decrypted data
            ```
        """
        try:
            # Get the server's X25519 encryption keypair
            if self.key_management_service:
                encryption_keypair = self.key_management_service.get_or_create_x25519_encryption_keypair()
                private_key = self.key_management_service.get_x25519_encryption_private_key(encryption_keypair)
            else:
                encryption_keypair = KeyManagementService.get_or_create_x25519_encryption_keypair()
                private_key = KeyManagementService.get_x25519_encryption_private_key(encryption_keypair)
            
            if not private_key:
                raise Exception("Failed to retrieve server X25519 encryption private key")
            
            # Decode the combined encrypted message
            combined: bytes = base64.b64decode(encrypted_message_b64)
            
            # Extract components
            key_length: int = int.from_bytes(combined[0:4], byteorder='big')
            encrypted_key: bytes = combined[4:4+key_length]
            encrypted_message: bytes = combined[4+key_length:]
            
            # Decrypt the symmetric key
            unseal_box: nacl.public.SealedBox = nacl.public.SealedBox(private_key)
            symmetric_key: bytes = unseal_box.decrypt(encrypted_key)
            
            # Use Aead to decrypt the message
            aead_box: nacl.secret.Aead = nacl.secret.Aead(symmetric_key)
            aad: bytes = b"NeuroController_aead_v1"  
            
            # Decrypt the message
            decrypted_message: bytes = aead_box.decrypt(encrypted_message, aad)
            
            return decrypted_message
            
        except Exception as e:
            error_msg: str = f"Failed to decrypt message: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def encrypt_and_sign_for_recipient(self, message: bytes, 
                                      recipient_x25519_public_key_b64: str) -> Dict[str, str]:
        """
        Encrypt and sign a message for secure and authenticated transmission.
        
        This method combines encryption and signing to provide:
        - Confidentiality: Only the recipient can read the message (via X25519 + XChaCha20)
        - Authentication: The recipient can verify the server sent it (via Ed25519 signature)
        - Integrity: The message cannot be tampered with
        
        Args:
            message: The message to encrypt and sign
            recipient_x25519_public_key_b64: Base64-encoded X25519 public key of the recipient.
                                            Must be an X25519 encryption key, not an Ed25519 signing key.
            
        Returns:
            Dict[str, str]: Dictionary containing:
                - 'encrypted_message': Base64-encoded encrypted message
                - 'signature': Base64-encoded Ed25519 signature
                - 'server_signing_public_key': Base64-encoded Ed25519 public key for verifying the signature
            
        Example:
            ```python
            service = EncryptionService()
            message = b"Confidential information"
            
            # The recipient's X25519 encryption public key (not their signing key)
            recipient_encryption_key = "..."  
            
            secure_package = service.encrypt_and_sign_for_recipient(
                message, 
                recipient_encryption_key
            )
            
            # secure_package now contains:
            # - encrypted_message: encrypted with recipient's X25519 public key
            # - signature: signed with server's Ed25519 private key
            # - server_signing_public_key: server's Ed25519 public key for signature verification
            ```
        """
        try:
            # First encrypt the message for the recipient
            encrypted_message_b64: str = self.encrypt_for_recipient(
                message, 
                recipient_x25519_public_key_b64
            )
            
            # Convert to bytes for signing
            encrypted_bytes: bytes = encrypted_message_b64.encode('utf-8')
            
            # Sign the encrypted message
            signature_b64, server_signing_public_key_b64 = self.signing_service.sign_message(encrypted_bytes)
            
            # Return all components
            return {
                'encrypted_message': encrypted_message_b64,
                'signature': signature_b64,
                'server_signing_public_key': server_signing_public_key_b64
            }
            
        except Exception as e:
            error_msg: str = f"Failed to encrypt and sign message: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    def verify_and_decrypt_from_sender(self, encrypted_message_b64: str, 
                                      signature_b64: str, 
                                      sender_ed25519_public_key_b64: str) -> bytes:
        """
        Verify and decrypt a message that was encrypted and signed by a sender.
        
        This method:
        1. Verifies the message signature using the sender's Ed25519 public key
        2. Decrypts the message using the server's X25519 private key
        
        Args:
            encrypted_message_b64: Base64-encoded encrypted message
            signature_b64: Base64-encoded Ed25519 signature
            sender_ed25519_public_key_b64: Base64-encoded Ed25519 public key of the sender.
                                         This must be an Ed25519 signing key, not an X25519 encryption key.
            
        Returns:
            bytes: The decrypted message
            
        Raises:
            Exception: If verification or decryption fails
            
        Example:
            ```python
            service = EncryptionService()
            # Extract components from client request
            encrypted_data = request.POST.get('encrypted_message')
            signature = request.POST.get('signature')
            
            # This is the sender's Ed25519 signing public key, not their X25519 encryption key
            client_signing_key = request.POST.get('client_signing_public_key')
            
            try:
                decrypted = service.verify_and_decrypt_from_sender(
                    encrypted_data, 
                    signature,
                    client_signing_key
                )
                # Process the decrypted confidential data
            except Exception as e:
                # Handle verification or decryption error
            ```
        """
        # First verify the signature
        try:
            # Prepare message for verification
            encrypted_bytes: bytes = encrypted_message_b64.encode('utf-8')
            
            # Verify using signing service
            is_valid: bool = self.signing_service.verify_signature(
                encrypted_bytes, 
                signature_b64, 
                sender_ed25519_public_key_b64
            )
            
            if not is_valid:
                raise nacl.exceptions.BadSignatureError("Signature verification failed")
            
            # If verification passes, decrypt the message
            return self.decrypt_from_sender(encrypted_message_b64)
            
        except nacl.exceptions.BadSignatureError:
            error_msg: str = "Signature verification failed. Message may have been tampered with or sender is not authentic."
            logger.warning(error_msg)
            raise Exception(error_msg)
            
        except Exception as e:
            error_msg: str = f"Failed to verify and decrypt message: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)
        
    def get_server_x25519_encryption_public_key(self) -> str:
        """
        Get the server's X25519 public key for encryption operations.
        
        This key should be shared with parties that need to send encrypted
        messages to this server.
        
        Returns:
            str: Base64-encoded X25519 public key
            
        Example:
            ```python
            service = EncryptionService()
            server_x25519_pubkey = service.get_server_x25519_encryption_public_key()
            # Share this public key with clients who need to encrypt data for the server
            ```
        """
        try:
            # Get the server's X25519 encryption keypair
            if self.key_management_service:
                encryption_keypair = self.key_management_service.get_or_create_x25519_encryption_keypair()
            else:
                encryption_keypair = KeyManagementService.get_or_create_x25519_encryption_keypair()
                
            return encryption_keypair.public_key
        
        except Exception as e:
            error_msg: str = f"Failed to retrieve server X25519 encryption public key: {str(e)}"
            logger.error(error_msg)
            raise Exception(error_msg)
    
    @staticmethod
    def encrypt_for_recipient_static(message: bytes, recipient_x25519_public_key_b64: str) -> str:
        """
        Static version of encrypt_for_recipient.
        
        Args:
            message: The bytes to encrypt
            recipient_x25519_public_key_b64: Base64-encoded X25519 public key of the recipient
            
        Returns:
            str: Base64-encoded encrypted message
            
        Raises:
            Exception: If encryption fails
            
        Example:
            ```python
            encrypted = EncryptionService.encrypt_for_recipient_static(
                b"Sensitive data",
                client_x25519_public_key
            )
            ```
        """
        service = EncryptionService()
        return service.encrypt_for_recipient(message, recipient_x25519_public_key_b64)
    
    @staticmethod
    def decrypt_from_sender_static(encrypted_message_b64: str) -> bytes:
        """
        Static version of decrypt_from_sender.
        
        Args:
            encrypted_message_b64: Base64-encoded encrypted message
            
        Returns:
            bytes: The decrypted message
            
        Raises:
            Exception: If decryption fails or server keys cannot be retrieved
            
        Example:
            ```python
            try:
                decrypted = EncryptionService.decrypt_from_sender_static(encrypted_data)
                # Process decrypted data
            except Exception as e:
                # Handle decryption error
            ```
        """
        service = EncryptionService()
        return service.decrypt_from_sender(encrypted_message_b64)
    
    @staticmethod
    def encrypt_and_sign_for_recipient_static(message: bytes, 
                                            recipient_x25519_public_key_b64: str) -> Dict[str, str]:
        """
        Static version of encrypt_and_sign_for_recipient.
        
        Args:
            message: The message to encrypt and sign
            recipient_x25519_public_key_b64: Base64-encoded X25519 public key of the recipient
            
        Returns:
            Dict[str, str]: Dictionary containing:
                - 'encrypted_message': Base64-encoded encrypted message
                - 'signature': Base64-encoded Ed25519 signature
                - 'server_signing_public_key': Base64-encoded Ed25519 public key for verification
                
        Raises:
            Exception: If encryption or signing fails
            
        Example:
            ```python
            secure_package = EncryptionService.encrypt_and_sign_for_recipient_static(
                b"Sensitive data",
                client_x25519_public_key
            )
            # Send secure_package to client
            ```
        """
        service = EncryptionService()
        return service.encrypt_and_sign_for_recipient(message, recipient_x25519_public_key_b64)
    
    @staticmethod
    def verify_and_decrypt_from_sender_static(encrypted_message_b64: str, 
                                            signature_b64: str, 
                                            sender_ed25519_public_key_b64: str) -> bytes:
        """
        Static version of verify_and_decrypt_from_sender.
        
        Args:
            encrypted_message_b64: Base64-encoded encrypted message
            signature_b64: Base64-encoded Ed25519 signature
            sender_ed25519_public_key_b64: Base64-encoded Ed25519 public key of the sender
            
        Returns:
            bytes: The decrypted message
            
        Raises:
            Exception: If verification or decryption fails
            
        Example:
            ```python
            try:
                decrypted = EncryptionService.verify_and_decrypt_from_sender_static(
                    encrypted_data,
                    signature,
                    client_ed25519_signing_public_key
                )
                # Process verified and decrypted data
            except Exception as e:
                # Handle verification or decryption error
            ```
        """
        service = EncryptionService()
        return service.verify_and_decrypt_from_sender(
            encrypted_message_b64, 
            signature_b64, 
            sender_ed25519_public_key_b64
        )
    
    @staticmethod
    def get_server_x25519_encryption_public_key_static() -> str:
        """
        Static version of get_server_x25519_encryption_public_key.
        
        Returns:
            str: Base64-encoded X25519 public key
            
        Example:
            ```python
            encryption_public_key = EncryptionService.get_server_x25519_encryption_public_key_static()
            print(f"Server X25519 encryption public key to share with clients: {encryption_public_key}")
            ```
        """
        service = EncryptionService()
        return service.get_server_x25519_encryption_public_key()