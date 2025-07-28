import uuid
from django.db import models


class EncryptionKeyPair(models.Model):
    """
    X25519 key pair for encryption/decryption operations.
    
    This model manages the server's X25519 keypairs used for asymmetric encryption
    and decryption operations. The server can use these keys to securely
    exchange data with clients using public key cryptography.
    
    Security features:
    - Private key separation: Private keys are stored securely outside the database
                             using the SecureKeyStorageService
    - Key rotation support: Multiple keypairs can exist with only one being active
    - Algorithm tracking: Records which cryptographic algorithm is in use (X25519)
    
    The encryption process works as follows:
    1. Clients use the server's public key to encrypt data that only the server can decrypt
    2. Server uses its private key to decrypt data from clients
    3. The server can also encrypt data for specific clients using their public keys
    
    These keypairs are specifically designed for encryption/decryption operations and
    are separate from the Ed25519 keypairs used for signing/verification operations.
    
    Attributes:
        id (UUID): Unique identifier for this keypair
        private_key_id (str): Identifier used to retrieve the private key from secure storage
        public_key (str): Base64-encoded X25519 public key
        algorithm (str): Cryptographic algorithm used ("x25519")
        is_active (bool): Whether this keypair is currently active
        created_at (datetime): When this keypair was created
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    private_key_id = models.CharField(max_length=128)
    public_key = models.TextField()
    algorithm = models.CharField(max_length=32)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'auth_encryption_key_pair'
        ordering = ['-created_at']
        
    def __str__(self):
        return f"{self.algorithm} Encryption Key {self.id}"