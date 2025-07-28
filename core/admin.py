from django.contrib import admin
from .models import ByteBridgeInstance, DataStore, Bucket, Object

@admin.register(ByteBridgeInstance)
class ByteBridgeInstanceAdmin(admin.ModelAdmin):
    list_display = ['name', 'instance_identifier', 'owner', 'is_registered', 'created_at']
    list_filter = ['is_registered', 'created_at'] 
    search_fields = ['name', 'instance_identifier']
    readonly_fields = ['id', 'created_at']

@admin.register(DataStore)
class DataStoreAdmin(admin.ModelAdmin):
    list_display = ('name', 'instance', 'owner', 'permission_type', 'created_at', 'is_active')
    search_fields = ('name', 'owner__username', 'instance__name')
    list_filter = ('permission_type', 'is_active', 'created_at')

@admin.register(Bucket)
class BucketAdmin(admin.ModelAdmin):
    list_display = ('name', 'datastore', 'owner', 'is_collection', 'get_permission', 'created_at')
    search_fields = ('name', 'owner__username', 'datastore__name')
    list_filter = ('is_collection', 'created_at')
    
    def get_permission(self, obj):
        return obj.get_effective_permission()
    get_permission.short_description = 'Permission'

@admin.register(Object)
class ObjectAdmin(admin.ModelAdmin):
    list_display = ('name', 'bucket', 'content_type', 'size', 'created_at')
    search_fields = ('name', 'bucket__name', 'content_type')
    list_filter = ('created_at', 'content_type')