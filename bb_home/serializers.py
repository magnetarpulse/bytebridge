from rest_framework import serializers
from .models import UploadedFileModel, get_datastore_path, UserDatastore

class UploadedFileModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = UploadedFileModel
        fields = '__all__'

class UserDatastoreSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserDatastore
        fields = '__all__'


