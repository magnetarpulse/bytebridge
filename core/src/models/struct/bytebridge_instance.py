from django.db import models
from django.contrib.auth.models import User
import uuid
import logging

logger = logging.getLogger(__name__)


class ByteBridgeInstance(models.Model):
    """
    Represents a ByteBridge storage instance.
    
    Each instance is owned by a single user and provides storage capabilities.
    Instances serve as the top-level container for organizing datastores, buckets,
    and objects in the storage hierarchy.
    """
    class Meta:
        ordering = ['-created_at']

    PERMISSION_CHOICES = [
        ('private', 'Private - Only owner can access'),
        ('public', 'Public - Others can read'),
        ('community', 'Community - Others can read and write'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    instance_identifier = models.CharField(max_length=255, unique=True)
    host = models.CharField(max_length=255, default='localhost')  
    port = models.IntegerField(default=8000)  
    permission_type = models.CharField(max_length=10, choices=PERMISSION_CHOICES, default='private')
    description = models.TextField(blank=True, null=True)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    is_registered = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_heartbeat = models.DateTimeField(null=True, blank=True)
    registration_ip = models.GenericIPAddressField(null=True, blank=True)
    neurocontroller_Ed25519_public_key = models.TextField(null=True, blank=True)
    neurocontroller_X25519_public_key = models.TextField(null=True, blank=True)
    
    def __str__(self):
        return self.name
    
    def get_api_endpoint(self):
        """
        Return the API endpoint for this instance.
        
        This method provides the endpoint that can be used to access
        this instance's API.
        
        Returns:
            str: The API endpoint URL
        """
        from django.conf import settings
        host = getattr(settings, 'API_HOST', self.host)  
        return f"{host}/api/instances/{self.instance_identifier}/"  
    
    def get_effective_permission(self):
        """
        Return the permission for this instance.
        
        Returns:
            str: The permission type
        """
        return self.permission_type