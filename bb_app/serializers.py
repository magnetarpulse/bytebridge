from rest_framework import serializers
from .models import *

class DatastoresSerializer(serializers.ModelSerializer):
    class Meta:
        model = Datastores
        fields = '__all__'
