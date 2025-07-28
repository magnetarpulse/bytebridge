"""
Authentication views for token revocation.

This module provides functionality to revoke JWT tokens, allowing users
to invalidate all their active sessions for security purposes.
"""
from rest_framework import status, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
import logging

# Set up logger for this module
logger = logging.getLogger(__name__)

class ByteBridgeTokenRevokeView(APIView):
    """
    Revoke all JWT tokens for the authenticated user.
    
    This is useful for logging out from all devices or revoking
    all access when credentials may be compromised.
    """
    permission_classes = [permissions.IsAuthenticated]
    
    def post(self, request):
        """
        Blacklist all outstanding tokens for the current user.
        
        Args:
            request: The HTTP request from the authenticated user
            
        Returns:
            Response: Confirmation of token revocation with count of revoked tokens
        """
        # Get all outstanding tokens for the user
        tokens = OutstandingToken.objects.filter(user_id=request.user.id)
        
        revoked_count = 0
        # Blacklist all outstanding tokens
        for token in tokens:
            try:
                BlacklistedToken.objects.get_or_create(token=token)
                revoked_count += 1
            except TokenError as e:
                logger.warning(f"Error blacklisting token: {str(e)}")
        
        return Response(
            {
                "detail": "All tokens have been revoked",
                "revoked_count": revoked_count
            }, 
            status=status.HTTP_200_OK
        )