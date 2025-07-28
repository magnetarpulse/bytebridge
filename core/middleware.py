"""
Middleware components for ByteBridge application.

This module contains security middlewares that provide an additional
layer of protection beyond the DRF permission classes.
"""
from django.http import HttpResponseForbidden
from core.models import (
    ByteBridgeInstance, DataStore, 
    Bucket, Object
)

class PermissionVerificationMiddleware:
    """
    Middleware to verify permissions for ByteBridge resources.
    
    This middleware provides an extra layer of security by checking resource 
    permissions at the HTTP request level, before reaching the view layer.
    It verifies access rights for:
    
    - ByteBridge instances
    - DataStores
    - Buckets
    - Objects
    
    Based on ownership and permission types (private, public, community).
    """
    
    def __init__(self, get_response):
        """
        Initialize the middleware with response handler.
        
        Args:
            get_response: The response handler callable
        """
        self.get_response = get_response

    def __call__(self, request):
        """
        Process the request and return the response.
        
        Args:
            request: The HTTP request object
            
        Returns:
            HttpResponse: The processed response
        """
        response = self.get_response(request)
        return response
    
    def process_view(self, request, view_func, view_args, view_kwargs):
        """
        Process the view by checking permissions before the view is called.
        
        Note: view_func and view_args are required parameters for Django middleware
        even if they are not directly used in this implementation.
        
        Args:
            request: The HTTP request object
            view_func: The view function to be called (unused but required by Django)
            view_args: Positional arguments for the view (unused but required by Django)
            view_kwargs: Keyword arguments for the view containing resource IDs
            
        Returns:
            None: If permission check passes
            HttpResponseForbidden: If permission check fails
        """
        # Skip for admin and authentication views
        if request.path.startswith('/admin/') or request.path.startswith('/api/auth/'):
            return None
            
        # Only check for authenticated users
        if not request.user.is_authenticated:
            return None
            
        # Extract resource IDs from URL kwargs
        instance_id = view_kwargs.get('instance_id')
        datastore_id = view_kwargs.get('datastore_id')
        bucket_id = view_kwargs.get('bucket_id')
        object_id = view_kwargs.get('object_id')
        
        # Define read-only HTTP methods
        read_only_methods = ['GET', 'HEAD', 'OPTIONS']
        
        # Check ByteBridge instance permission
        if instance_id:
            try:
                instance = ByteBridgeInstance.objects.get(id=instance_id)
                if instance.owner != request.user:
                    return HttpResponseForbidden(
                        "You don't have permission to access this ByteBridge instance"
                    )
            except ByteBridgeInstance.DoesNotExist:
                # Let the view handle the 404 response
                pass
                
        # Check DataStore permission
        if datastore_id:
            try:
                datastore = DataStore.objects.get(id=datastore_id)
                if datastore.owner != request.user:
                    # Private resources are completely restricted
                    if datastore.permission_type == 'private':
                        return HttpResponseForbidden(
                            "You don't have permission to access this DataStore"
                        )
                    # Public resources allow read but not write
                    elif datastore.permission_type == 'public' and request.method not in read_only_methods:
                        return HttpResponseForbidden(
                            "You only have read permission for this DataStore"
                        )
            except DataStore.DoesNotExist:
                # Let the view handle the 404 response
                pass
                
        # Check Bucket permission
        if bucket_id:
            try:
                bucket = Bucket.objects.get(id=bucket_id)
                if bucket.owner != request.user:
                    permission_type = bucket.get_effective_permission()
                    # Private resources are completely restricted
                    if permission_type == 'private':
                        return HttpResponseForbidden(
                            "You don't have permission to access this Bucket"
                        )
                    # Public resources allow read but not write
                    elif permission_type == 'public' and request.method not in read_only_methods:
                        return HttpResponseForbidden(
                            "You only have read permission for this Bucket"
                        )
            except Bucket.DoesNotExist:
                # Let the view handle the 404 response
                pass
                
        # Check Object permission
        if object_id:
            try:
                file_object = Object.objects.get(id=object_id)
                bucket = file_object.bucket
                
                if bucket.owner != request.user:
                    permission_type = bucket.get_effective_permission()
                    # Private resources are completely restricted
                    if permission_type == 'private':
                        return HttpResponseForbidden(
                            "You don't have permission to access this Object"
                        )
                    # Public resources allow read but not write
                    elif permission_type == 'public' and request.method not in read_only_methods:
                        return HttpResponseForbidden(
                            "You only have read permission for this Object"
                        )
                    # Community resources allow read and write but not deletion or modification
                    elif permission_type == 'community' and request.method in ['PUT', 'PATCH', 'DELETE']:
                        return HttpResponseForbidden(
                            "You cannot modify or delete objects in a community bucket"
                        )
            except Object.DoesNotExist:
                # Let the view handle the 404 response
                pass
                
        return None

class JavaScriptMimeTypeMiddleware:
    """Ensure JavaScript files are served with the correct MIME type."""
    
    def __init__(self, get_response):
        self.get_response = get_response
        
    def __call__(self, request):
        response = self.get_response(request)
        
        # Check if the requested path is for a JavaScript file
        if request.path.endswith('.js'):
            print(f"Setting Content-Type for JavaScript file: {request.path}")
            response['Content-Type'] = 'application/javascript'
            print(f"Content-Type set to {response.get('Content-Type')}")
        
        return response