"""
ViewSet for DataStore instances that handles CRUD operations.
This module defines the API endpoints for managing DataStore objects with appropriate permissions.
"""
from django.db import models
from rest_framework import viewsets, permissions, filters
from django_filters.rest_framework import DjangoFilterBackend
from core.models import DataStore
from api.serializers import DataStoreSerializer
from core.permissions import HasDataStorePermission

class DataStoreViewSet(viewsets.ModelViewSet):
    """
    API endpoint for DataStores.
    
    This viewset provides CRUD operations for DataStore objects:
    - List accessible datastores (owned, public, and community)
    - Create new datastores
    - Retrieve specific datastores
    - Update existing datastores (with appropriate permissions)
    - Delete datastores (with appropriate permissions)
    
    Filtering is available by name, permission_type, and active status.
    Search functionality is provided across name and description fields.
    Results can be ordered by name or creation date.
    """
    serializer_class = DataStoreSerializer
    permission_classes = [permissions.IsAuthenticated, HasDataStorePermission]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['name', 'permission_type', 'is_active']
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']
    
    def get_queryset(self):
        """
        Filter queryset based on ownership and permission settings.
        
        Users can access:
        1. DataStores they own
        2. DataStores with 'public' permission type
        3. DataStores with 'community' permission type
        
        Returns:
            QuerySet: Filtered DataStore objects the user can access
        """
        # Skip filtering for schema generation to avoid errors in OpenAPI schema
        if getattr(self, 'swagger_fake_view', False):
            return DataStore.objects.none()
            
        current_user = self.request.user
        
        # Use Q objects to combine filter conditions with OR logic
        access_conditions = models.Q(
            owner=current_user
        ) | models.Q(
            permission_type='public'
        ) | models.Q(
            permission_type='community'
        )
        
        return DataStore.objects.filter(access_conditions)