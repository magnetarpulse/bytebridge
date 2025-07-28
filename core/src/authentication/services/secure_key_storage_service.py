import keyring
import keyrings.alt.file
from keyrings.alt.file import EncryptedKeyring
import os
import logging
from typing import Optional, Union

logger = logging.getLogger(__name__)

SERVICE_NAME: str = "bytebridge.server_keys"
FALLBACK_ENV_VAR: str = "BYTEBRIDGE_SERVER_PRIVATE_KEYS"
FALLBACK_FILE: str = os.path.expanduser("~/.bytebridge/server_keys.enc")


class SecureKeyStorageService:
    """
    Secure key storage service using system keyring with multiple fallbacks.
    
    This service attempts to use various secure storage mechanisms in this order:
    1. System keyring (GNOME Keyring, KWallet, etc.)
    2. File-based encrypted keyring (with master password from environment) 
    3. Encrypted environment variable
    
    This ensures the server can run in various environments while
    maintaining appropriate security for private keys.
    
    Attributes:
        SERVICE_NAME: Identifier for the keyring service
        FALLBACK_ENV_VAR: Environment variable name for fallback storage
        FALLBACK_FILE: Path to encrypted keyring file for fallback storage
    """
    
    @staticmethod
    def _get_keyring() -> Union[keyring.backend.KeyringBackend, EncryptedKeyring]:
        """
        Get the appropriate keyring backend.
        
        Returns the best available keyring backend for the current environment.
        Falls back to encrypted file keyring if system keyring is unavailable.
        
        During fallback, the method will:
        1. Create the directory for the encrypted keyring file if it doesn't exist
        2. Try to get the master password from the NC_KEYRING_PASSWORD environment variable
        3. If the environment variable is not set, prompt the user for input
        
        Returns:
            Union[keyring.backend.KeyringBackend, EncryptedKeyring]: The keyring backend
            
        Raises:
            RuntimeError: If no keyring backend can be initialized
        """
        try:
            # Try default keyring first (system keyring)
            default_keyring: keyring.backend.KeyringBackend = keyring.get_keyring()
            
            # Test if it works, it will raise an exception if not
            # This is a simple test to check if the keyring is available
            random_hex: str = os.urandom(4).hex()
            test_key: str = f"test_key_{random_hex}"
            default_keyring.set_password(SERVICE_NAME, test_key, "test_value")
            default_keyring.delete_password(SERVICE_NAME, test_key)
            return default_keyring
        except Exception as e:
            logger.warning(f"System keyring not available: {str(e)}. Falling back to encrypted file.")
            
            # Set up encrypted file keyring as fallback
            os.makedirs(os.path.dirname(FALLBACK_FILE), exist_ok=True)
            
            # Get master password from environment or ask from stdin
            master_password: Optional[str] = os.environ.get("NC_KEYRING_PASSWORD")
            if not master_password:
                master_password = input("Enter master password for encrypted keyring: ")
                
            file_keyring: EncryptedKeyring = keyrings.alt.file.EncryptedKeyring()
            file_keyring.file_path = FALLBACK_FILE
            file_keyring.keyring_key = master_password
            return file_keyring
    
    @staticmethod
    def store_private_key(key_id: str, private_key: str) -> bool:
        """
        Securely store a private key in the keyring.
        
        Args:
            key_id: Unique identifier for the key
            private_key: The private key string to store (base64 encoded)
            
        Returns:
            bool: True if storage was successful, False otherwise
            
        Example:
            ```python
            success = SecureKeyStorageService.store_private_key(
                "server_ed25519_1", 
                "<base64_encoded_private_key>"
            )
            ```
        """
        try:
            kr: Union[keyring.backend.KeyringBackend, EncryptedKeyring] = SecureKeyStorageService._get_keyring()
            key_name: str = f"private_key_{key_id}"
            kr.set_password(SERVICE_NAME, key_name, private_key)
            return True
        except Exception as e:
            logger.error(f"Failed to store private key in keyring: {str(e)}")
            return False
    
    @staticmethod
    def retrieve_private_key(key_id: str) -> Optional[str]:
        """
        Retrieve a private key from secure storage.
        
        Args:
            key_id: Unique identifier for the key
            
        Returns:
            Optional[str]: The retrieved private key or None if not found or on error
            
        Raises:
            No exceptions are raised, failures return None and are logged.
            
        Example:
            ```python
            private_key = SecureKeyStorageService.retrieve_private_key("server_ed25519_1")
            if private_key:
                # Use the private key for cryptographic operations
            ```
        """
        try:
            kr: Union[keyring.backend.KeyringBackend, EncryptedKeyring] = SecureKeyStorageService._get_keyring()
            key_name: str = f"private_key_{key_id}"
            return kr.get_password(SERVICE_NAME, key_name)
        except Exception as e:
            logger.error(f"Failed to retrieve private key from keyring: {str(e)}")
            return None
    
    @staticmethod
    def delete_private_key(key_id: str) -> bool:
        """
        Delete a private key from secure storage.
        
        Args:
            key_id: Unique identifier for the key
            
        Returns:
            bool: True if deletion was successful, False if key not found or on error
            
        Raises:
            No exceptions are raised, failures return False and are logged.
            
        Example:
            ```python
            if SecureKeyStorageService.delete_private_key("server_ed25519_1"):
                print("Key successfully deleted")
            ```
        """
        try:
            kr: Union[keyring.backend.KeyringBackend, EncryptedKeyring] = SecureKeyStorageService._get_keyring()
            key_name: str = f"private_key_{key_id}"
            kr.delete_password(SERVICE_NAME, key_name)
            return True
        except Exception as e:
            logger.error(f"Failed to delete private key from keyring: {str(e)}")
            return False