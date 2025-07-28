from django.db import models
from django.contrib.auth.models import User
from .bytebridge_instance import ByteBridgeInstance
import logging

logger = logging.getLogger(__name__)


class DataStore(models.Model):
    """
    A DataStore within a ByteBridge instance.
    
    DataStores are logical containers for organizing buckets and can have
    different permission levels: private, public, or community. This allows
    for flexible access control to data at various hierarchy levels.
    """
    class Meta:
        ordering = ['-created_at'] 
    
    PERMISSION_CHOICES = [
        ('private', 'Private - Only owner can access'),
        ('public', 'Public - Others can read'),
        ('community', 'Community - Others can read and write'),
    ]
    
    name = models.CharField(max_length=255)
    instance = models.ForeignKey(ByteBridgeInstance, on_delete=models.CASCADE, related_name='datastores')
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='owned_datastores')
    permission_type = models.CharField(max_length=10, choices=PERMISSION_CHOICES, default='private')
    created_at = models.DateTimeField(auto_now_add=True)
    description = models.TextField(blank=True, null=True)
    is_active = models.BooleanField(default=True)
    last_synced = models.DateTimeField(null=True, blank=True)
    
    def __str__(self):
        return f"{self.name} ({self.get_permission_type_display()})"