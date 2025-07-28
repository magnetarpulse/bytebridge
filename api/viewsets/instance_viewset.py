"""
ViewSet for ByteBridge instances that handles CRUD operations and custom actions.
This module defines the API endpoints for managing ByteBridge instances.
"""
from django.utils import timezone
from rest_framework import viewsets, permissions, filters, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from core.models import ByteBridgeInstance
from api.serializers import ByteBridgeInstanceSerializer
from core.permissions import IsByteBridgeOwner

class ByteBridgeInstanceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for ByteBridge instances.
    
    This viewset provides CRUD operations for ByteBridge instances:
    - List all instances owned by the current user
    - Create new instances
    - Retrieve specific instances
    - Update existing instances
    - Delete instances
    
    Also provides custom actions:
    - connect_to_controller: Initiates connection to the NeuroController
    """
    serializer_class = ByteBridgeInstanceSerializer
    permission_classes = [permissions.IsAuthenticated, IsByteBridgeOwner]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['name', 'is_active']
    search_fields = ['name']
    ordering_fields = ['name', 'created_at']
    
    def get_queryset(self):
        """
        Filter queryset to return only instances owned by the requesting user.
        
        Returns:
            QuerySet: Filtered ByteBridge instances ordered by creation date (newest first)
        """
        # Skip filtering for schema generation to avoid errors in OpenAPI schema
        if getattr(self, 'swagger_fake_view', False):
            return ByteBridgeInstance.objects.none()
            
        current_user = self.request.user
        return ByteBridgeInstance.objects.filter(
            owner=current_user
        ).order_by('-created_at')
    
    @action(detail=True, methods=['post'])
    def connect_to_controller(self, request, pk=None):
        """
        Connect a ByteBridge instance to the NeuroController.
        
        This endpoint updates the last_connected timestamp and initiates
        the connection process with the NeuroController service.
        
        Args:
            request: The HTTP request
            pk: Primary key of the ByteBridge instance
            
        Returns:
            Response: Status of the connection attempt
        """
        # Get the specific instance the user is trying to connect
        instance = self.get_object()
        
        # TODO: Implement actual connection logic to NeuroController service
        # For now, just update the last_connected timestamp to track connection attempts
        instance.last_connected = timezone.now()
        instance.save(update_fields=['last_connected'])
        
        # Return success response
        return Response(
            {'status': 'connection initiated', 'timestamp': instance.last_connected},
            status=status.HTTP_200_OK
        )