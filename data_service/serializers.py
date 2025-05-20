from rest_framework import serializers
from .models import *

class DatastoresSerializer(serializers.ModelSerializer):
    class Meta:
        model = Datastores
        fields = '__all__'


class BucketsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Buckets
        fields = '__all__'


class ObjectsSerializer(serializers.ModelSerializer):
    class Meta:
        model = Objects
        fields = '__all__'