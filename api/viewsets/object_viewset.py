"""
ViewSet for Object entities that handles CRUD operations.
This module defines the API endpoints for managing file objects with appropriate permissions.
"""
from django.db import models
from rest_framework import viewsets, permissions, filters
from django_filters.rest_framework import DjangoFilterBackend
from core.models import Object
from api.serializers import ObjectSerializer
from core.permissions import HasObjectPermission

class ObjectViewSet(viewsets.ModelViewSet):
    """
    API endpoint for Objects (files).
    
    This viewset provides CRUD operations for file objects:
    - List accessible files (in owned buckets, public buckets, or community buckets)
    - Create new file objects
    - Retrieve specific files
    - Update existing files (with appropriate permissions)
    - Delete files (with appropriate permissions)
    
    Filtering is available by name, content_type, and bucket.
    Search functionality is provided for the name field.
    Results can be ordered by name, creation date, or file size.
    """
    serializer_class = ObjectSerializer
    permission_classes = [permissions.IsAuthenticated, HasObjectPermission]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['name', 'content_type', 'bucket']
    search_fields = ['name']
    ordering_fields = ['name', 'created_at', 'size']
    
    def get_queryset(self):
        """
        Filter querysets based on bucket ownership and permission settings.
        
        Users can access:
        1. Objects in buckets they own
        2. Objects in buckets with public permission
        3. Objects in buckets with community permission
        4. Objects in buckets that belong to datastores with public permission
        5. Objects in buckets that belong to datastores with community permission
        
        Returns:
            QuerySet: Filtered Object instances the user can access,
                     with related bucket and datastore data preloaded
        """
        # Skip filtering for schema generation to avoid errors in OpenAPI schema
        if getattr(self, 'swagger_fake_view', False):
            return Object.objects.none()
            
        current_user = self.request.user
        
        # Define access conditions using Q objects for complex permission logic
        access_conditions = models.Q(
            bucket__owner=current_user
        ) | models.Q(
            bucket__datastore__permission_type='public'
        ) | models.Q(
            bucket__datastore__permission_type='community'
        ) | models.Q(
            bucket__permission_type='public'
        ) | models.Q(
            bucket__permission_type='community'
        )
        
        # Use select_related to optimize database queries by prefetching related objects
        return Object.objects.filter(access_conditions).select_related(
            'bucket', 
            'bucket__datastore'
        )