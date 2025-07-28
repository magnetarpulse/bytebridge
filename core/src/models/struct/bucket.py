from django.db import models
from django.contrib.auth.models import User
from .datastore import DataStore
import logging

logger = logging.getLogger(__name__)


class Bucket(models.Model):
    """
    A Bucket within a DataStore that contains Objects.
    
    Buckets serve as containers for objects (files) and can inherit
    permission settings from their parent DataStore or override them with
    their own permission settings for more granular access control.
    """
    class Meta:
        ordering = ['-created_at']
    
    name = models.CharField(max_length=255)
    datastore = models.ForeignKey(DataStore, on_delete=models.CASCADE, related_name='buckets')
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name='owned_buckets')
    is_collection = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    # Buckets inherit permissions from their DataStore, but can override
    permission_type = models.CharField(
        max_length=10, 
        choices=DataStore.PERMISSION_CHOICES, 
        null=True, blank=True
    )
    
    def get_effective_permission(self):
        """
        Return the effective permission for this bucket.
        
        If the bucket has its own permission setting, use that.
        Otherwise, inherit the permission from the parent DataStore.
        
        Returns:
            str: The effective permission type
        """
        return self.permission_type or self.datastore.permission_type
    
    def __str__(self):
        return self.name