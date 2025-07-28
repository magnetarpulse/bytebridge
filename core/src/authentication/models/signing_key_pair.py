from django.db import models
import uuid


class SigningKeyPair(models.Model):
    """
    Stores the server's Ed25519 cryptographic keypairs for signing and verification.
    
    This model manages the server's Ed25519 keypairs used for digital signatures
    and verification. These signatures provide authentication and integrity
    for server-generated messages and tokens.
    
    Security features:
    - Private key separation: Private keys are stored securely outside the database
                            using the SecureKeyStorageService
    - Key rotation support: Multiple keypairs can exist with only one being active
    - Algorithm tracking: Records which cryptographic algorithm is in use (Ed25519)
    
    The signing process works as follows:
    1. Server signs data with its private key
    2. Clients verify the signature using the server's public key
    3. This allows clients to be certain that data originated from the server
       and hasn't been tampered with
    
    These keypairs are specifically designed for signing/verification operations
    and are separate from the X25519 keypairs used for encryption/decryption.
    
    Attributes:
        id (UUID): Unique identifier for this keypair
        private_key_id (str): Identifier used to retrieve the private key from secure storage
        public_key (str): Base64-encoded Ed25519 public key
        algorithm (str): Cryptographic algorithm used ("ed25519") 
        created_at (datetime): When this keypair was created
        is_active (bool): Whether this keypair is currently active
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    private_key_id = models.CharField(max_length=100, help_text="ID reference for private key in system keyring")
    public_key = models.TextField(help_text="Server's public key (shared with clients)")
    algorithm = models.CharField(max_length=30, default="ed25519")
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    
    class Meta:
        ordering = ['-created_at']
    
    def __str__(self) -> str:
        """
        Return a string representation of the SigningKeyPair object.
        
        This method provides a human-readable identifier for the key pair,
        which is used in the Django admin interface, debugging output,
        and string conversion contexts.
        
        Returns:
            str: A formatted string containing the key's UUID and algorithm
        """
        return f"Server Key {self.id} - {self.algorithm}"