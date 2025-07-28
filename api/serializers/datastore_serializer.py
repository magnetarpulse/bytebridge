from rest_framework import serializers
from core.models import DataStore
from api.serializers.user_serializer import UserSerializer

class DataStoreSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    
    class Meta:
        model = DataStore
        fields = ['id', 'name', 'instance', 'owner', 'permission_type', 
                  'created_at', 'description', 'is_active']
        read_only_fields = ['owner', 'created_at']
    
    def create(self, validated_data):
        validated_data['owner'] = self.context['request'].user
        return super().create(validated_data)