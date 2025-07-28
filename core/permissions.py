from rest_framework import permissions
from core.models import DataStore

class IsByteBridgeOwner(permissions.BasePermission):
    """
    Permission to only allow owners of a ByteBridge instance to access it.
    """
    def has_object_permission(self, request, view, obj):
        # Check if the requesting user is the owner of the instance
        return obj.owner == request.user

class HasDataStorePermission(permissions.BasePermission):
    """
    Permission to check if user has appropriate DataStore access based on permission_type.
    
    Handles different levels of access based on the DataStore's permission setting:
    - Private: Only owner has access
    - Public: Anyone can read, only owner can write
    - Community: Anyone can read and write, but only owner can delete
    """
    def has_permission(self, request, view):  
        # For create/list, we'll check in the viewset or has_object_permission
        return True
        
    def has_object_permission(self, request, view, obj):  
        # Owner always has full permissions
        if obj.owner == request.user:
            return True
            
        # For non-owners, check permission_type
        if obj.permission_type == 'private':
            return False
        elif obj.permission_type == 'public':
            # Public allows read operations only
            return request.method in permissions.SAFE_METHODS
        elif obj.permission_type == 'community':
            # Community allows read and write for GET, POST, PUT/PATCH (but not DELETE)
            if request.method == 'DELETE':
                return False
            return True
        return False

class HasBucketPermission(permissions.BasePermission):
    """
    Permission to check if user has appropriate Bucket access based on effective permission.
    
    Handles:
    1. Create permissions based on parent DataStore permissions
    2. Object-level permissions based on the Bucket's effective permission
    """
    def has_permission(self, request, view):  
        # For create operations, check the datastore permission
        if request.method == 'POST':
            datastore_id = request.data.get('datastore')
            if datastore_id:
                try:
                    # Convert to int first to catch non-numeric values
                    datastore_id = int(datastore_id)
                    datastore = DataStore.objects.get(pk=datastore_id)
                    # Only allow bucket creation in:
                    # 1. User's own datastores
                    # 2. Community datastores
                    return datastore.owner == request.user or datastore.permission_type == 'community'
                except (DataStore.DoesNotExist, ValueError, TypeError):
                    # Return True to allow the request to proceed to validation
                    # The serializer will catch the invalid ID and return 400
                    return True
        return True  # For other operations, check has_object_permission
        
    def has_object_permission(self, request, view, obj):  
        # Owner always has full permissions
        if obj.owner == request.user:
            return True
            
        # Check bucket's own permission first, if set
        if obj.permission_type:
            permission_type = obj.permission_type
        else:
            # Otherwise inherit from datastore
            permission_type = obj.datastore.permission_type
            
        if permission_type == 'private':
            return False
        elif permission_type == 'public':
            # Public allows read operations only
            return request.method in permissions.SAFE_METHODS
        elif permission_type == 'community':
            # Community allows read and write
            return True
        return False

class HasObjectPermission(permissions.BasePermission):
    """
    Permission to check if user has appropriate Object access based on parent bucket's permission.
    
    Access rules:
    - Private: Only bucket owner has access
    - Public: Anyone can read, only bucket owner can write
    - Community: Anyone can read and create new objects, but not modify or delete existing ones
    """
    def has_object_permission(self, request, view, obj):  
        # Delegate to bucket permission check
        bucket = obj.bucket
        # Owner of bucket has full access
        if bucket.owner == request.user:
            return True
            
        # Check effective permission
        permission_type = bucket.get_effective_permission()
            
        if permission_type == 'private':
            return False
        elif permission_type == 'public':
            # Public allows read operations only
            return request.method in permissions.SAFE_METHODS
        elif permission_type == 'community':
            # Community allows read and create (but not modify/delete)
            return request.method in permissions.SAFE_METHODS or request.method == 'POST'
        return False