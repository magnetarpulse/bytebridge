"""
Views for verifying authentication tokens and retrieving user information.

This module provides endpoints to validate tokens and retrieve user data,
ensuring that authentication is valid and returning relevant user context.
"""
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import ByteBridgeInstance

class ByteBridgeTokenVerificationView(APIView):
    """
    Verify JWT tokens and return user information.
    
    This view allows clients to validate their authentication tokens and
    retrieve associated user data and ByteBridge instance access information.
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def get(self, request):
        """
        Verify the token and return user and instance information.
        
        Args:
            request: The HTTP request with the token to verify
            
        Returns:
            Response: User profile information and ByteBridge instance access
        """
        user = request.user
        
        # Get ByteBridge instances for this user
        instances = ByteBridgeInstance.objects.filter(
            owner=user
        ).values('id', 'name')
        
        return Response({
            'username': user.username,
            'user_id': user.id,
            'email': user.email,
            'is_active': user.is_active,
            'bytebridge_instances': list(instances)
        }, status=status.HTTP_200_OK)