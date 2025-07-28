"""
Views for generating long-lived API keys for ByteBridge external integrations.

This module provides functionality to create extended-lifetime authentication tokens,
designed for external applications and service integrations that require persistent access.
"""
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

class ByteBridgeAPIKeyView(APIView):
    """
    Generate a long-lived ByteBridge API key for external access.
    
    These API keys have extended lifetimes compared to regular JWT tokens
    and are intended for persistent authentication needs where frequent
    re-authentication would be impractical.
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request):
        """
        Create a new long-lived API key for the authenticated user.
        
        This endpoint generates a JWT token with extended validity,
        allowing users to maintain authentication for extended periods
        without needing to re-authenticate.
        
        Args:
            request: The HTTP request from the authenticated user
            
        Returns:
            Response: The generated API key information including access
                     and refresh tokens along with user details
        """
        # Create a refresh token with extended lifetime
        refresh = RefreshToken.for_user(request.user)
        
        # Mark this token with a special type to identify it as a ByteBridge API key
        refresh['token_type'] = 'bytebridge_api_key'
        
        # Generate the access token with same extended lifetime
        access_token = refresh.access_token
        
        return Response({
            'access': str(access_token),
            'refresh': str(refresh),
            'token_type': 'bytebridge_api_key',
            'user_id': request.user.id,
            'username': request.user.username
        }, status=status.HTTP_201_CREATED)