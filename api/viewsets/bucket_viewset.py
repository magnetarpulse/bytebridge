"""
ViewSet for Bucket objects that handles CRUD operations.
This module defines the API endpoints for managing Buckets with appropriate permissions.
"""
from django.db import models
from rest_framework import viewsets, permissions, filters, status
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from core.models import Bucket
from api.serializers import BucketSerializer
from core.permissions import HasBucketPermission

class BucketViewSet(viewsets.ModelViewSet):
    """
    API endpoint for Buckets.
    
    This viewset provides CRUD operations for Bucket objects:
    - List accessible buckets (owned, public, and from public/community datastores)
    - Create new buckets
    - Retrieve specific buckets
    - Update existing buckets (with appropriate permissions)
    - Delete buckets (with appropriate permissions)
    
    Filtering is available by name, is_collection flag, and datastore.
    Search functionality is provided across name field.
    Results can be ordered by name or creation date.
    """
    serializer_class = BucketSerializer
    permission_classes = [permissions.IsAuthenticated, HasBucketPermission]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['name', 'is_collection', 'datastore']
    search_fields = ['name']
    ordering_fields = ['name', 'created_at']
    
    def create(self, request, *args, **kwargs):
        """
        Handle bucket creation with proper validation.
        
        Performs initial validation before permission checks to provide
        better error messages to the client.
        
        Args:
            request: The HTTP request containing bucket data
            
        Returns:
            Response: The created bucket or validation errors
        """
        # First validate the data format before permission checks
        serializer = self.get_serializer(data=request.data)
        
        try:
            # Validate without immediately raising exceptions
            if not serializer.is_valid():
                return Response(
                    serializer.errors, 
                    status=status.HTTP_400_BAD_REQUEST
                )
        except Exception as e:
            # Handle any unexpected errors during validation
            return Response(
                {"detail": f"Validation error: {str(e)}"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # If validation passes, proceed with normal creation process
        return super().create(request, *args, **kwargs)
    
    def get_queryset(self):
        """
        Filter querysets based on user permissions and request context.
        
        For list views, users can see:
        1. Buckets they own
        2. Buckets with public permission
        3. Buckets with community permission
        4. Buckets in datastores with public permission
        5. Buckets in datastores with community permission
        
        For detail views, we return all buckets and let permission classes
        handle access control for consistent 403 responses.
        
        Returns:
            QuerySet: Filtered Bucket objects the user can access
        """
        # Skip filtering for schema generation to avoid errors
        if getattr(self, 'swagger_fake_view', False):
            return Bucket.objects.none()
            
        current_user = self.request.user
        
        # For detail view (retrieving specific bucket), return unfiltered queryset
        # This enables proper 403 responses instead of 404s when permission is denied
        if self.action == 'retrieve' and self.kwargs.get('pk'):
            return Bucket.objects.all()
        
        # For list views, apply permission-based filtering
        access_conditions = models.Q(
            owner=current_user
        ) | models.Q(
            datastore__permission_type='public'
        ) | models.Q(
            datastore__permission_type='community'
        ) | models.Q(
            permission_type='public'
        ) | models.Q(
            permission_type='community'
        )
        
        # Use select_related to optimize datastore access
        return Bucket.objects.filter(access_conditions).select_related('datastore')