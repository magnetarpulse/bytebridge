from rest_framework import serializers
from core.models import Object

class ObjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Object
        fields = ['id', 'name', 'bucket', 'file', 'content_type', 
                  'size', 'created_at', 'checksum']
        read_only_fields = ['created_at', 'size', 'content_type', 'checksum']
    
    def create(self, validated_data):
        file = validated_data.get('file')
        if file:
            validated_data['size'] = file.size
            validated_data['content_type'] = file.content_type or 'application/octet-stream'
        
        return super().create(validated_data)