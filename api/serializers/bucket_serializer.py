from rest_framework import serializers
from core.models import Bucket
from api.serializers.user_serializer import UserSerializer

class BucketSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    effective_permission = serializers.SerializerMethodField()
    
    class Meta:
        model = Bucket
        fields = ['id', 'name', 'datastore', 'owner', 'is_collection', 
                  'created_at', 'permission_type', 'effective_permission']
        read_only_fields = ['owner', 'created_at']
    
    def get_effective_permission(self, obj):
        return obj.get_effective_permission()
    
    def create(self, validated_data):
        validated_data['owner'] = self.context['request'].user
        return super().create(validated_data)
    
    def validate_datastore(self, value):
        """Validate that the user can create buckets in this datastore"""
        request = self.context.get('request')
        if value.owner != request.user and value.permission_type != 'community':
            raise serializers.ValidationError(
                "You can only create buckets in your own datastores or community datastores")
        return value