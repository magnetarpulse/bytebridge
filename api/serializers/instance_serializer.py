from rest_framework import serializers
from core.models import ByteBridgeInstance
from api.serializers.user_serializer import UserSerializer

class ByteBridgeInstanceSerializer(serializers.ModelSerializer):
    owner = UserSerializer(read_only=True)
    
    class Meta:
        model = ByteBridgeInstance
        fields = ['id', 'name', 'owner', 'api_token', 'created_at', 'is_active', 'last_connected']
        read_only_fields = ['owner', 'created_at', 'last_connected']
    
    def create(self, validated_data):
        validated_data['owner'] = self.context['request'].user
        return super().create(validated_data)