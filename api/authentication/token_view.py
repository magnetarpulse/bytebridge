"""
Authentication views for JWT token generation.

This module provides endpoints to create authentication tokens,
extending the standard JWT functionality with ByteBridge-specific
user and instance information.
"""
from rest_framework import status
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance
import logging

# Set up logger for this module
logger = logging.getLogger(__name__)

class ByteBridgeTokenView(TokenObtainPairView):
    """
    Obtain a JWT token pair for ByteBridge API access.
    
    Extends the standard JWT token view to include ByteBridge instance 
    information in the response, providing everything a client needs
    in a single authentication request.
    """
    def post(self, request, *args, **kwargs):
        """
        Generate JWT tokens and add ByteBridge instance information.
        
        Args:
            request: The HTTP request with login credentials
            
        Returns:
            Response: JWT tokens and ByteBridge instance information
        """
        response = super().post(request, *args, **kwargs)
        
        # Add ByteBridge instance info to the response if successful
        if response.status_code == 200:
            access_token = response.data.get('access')
            if access_token:
                try:
                    # Decode the access token to get user id
                    token_data = AccessToken(access_token)
                    user_id = token_data['user_id']
                    user = User.objects.get(id=user_id)
                    
                    # Get ByteBridge instances for this user
                    instances = ByteBridgeInstance.objects.filter(
                        owner=user
                    ).values('id', 'name')
                    
                    # Add to response
                    response.data['bytebridge_instances'] = list(instances)
                    response.data['username'] = user.username
                    
                except Exception as e:
                    # Log but don't fail the token generation
                    logger.error(f"Error adding ByteBridge instance data: {str(e)}")
        
        return response