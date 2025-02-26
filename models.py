import os
import uuid
from django.db import models
from django.conf import settings


# Create your models here.


class UserDatastore(models.Model):
    """ Model to store a persistent datastore_id for each user created on an instance of BB """

    user_id = models.IntegerField(blank=True, null=True) 
    instance_id = models.UUIDField(default=uuid.uuid4, editable=False) 
    datastore_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    datastore_name = models.CharField(max_length=100, blank=True)
    datastore_private = models.BooleanField(default=True) # True if the datastore is private to the user, False if it is public
    ds_default = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    

    def __str__(self):
        return f"Datastore for {self.instance_id}: {self.datastore_id}"



class UserBucket(models.Model):
    """ Model to store a persistent datastore_id for each user created on an instance of BB """

    
    user_id = models.IntegerField(blank=True, null=True) 
    instance_id = models.UUIDField(default=uuid.uuid4, editable=False)
    
    datastore_id = models.ForeignKey(UserDatastore, on_delete=models.CASCADE) # ForeignKey to the UserDatastore model

    bucket_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    bucket_name = models.CharField(max_length=100, blank=True)
    bucket_private = models.BooleanField(default=True) # True if the bucket is private to the user, False if it is public
    bucket_default = models.BooleanField(default=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"Bucket for {self.instance_id}: {self.bucket_id}"


class UploadedFileModel(models.Model):
    """ Model to store a persistent file upload path with datastore id and user id for each user with privacy settings """
    
    file_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    user_id = models.IntegerField(blank=True, null=True)
    instance_id = models.UUIDField(default=uuid.uuid4, editable=False)
    
    datastore_id = models.ForeignKey(UserDatastore, on_delete=models.CASCADE) # ForeignKey to the UserDatastore model
    bucket_id = models.ForeignKey(UserBucket, on_delete=models.CASCADE) # ForeignKey to the UserBucket model

    file_name = models.CharField(max_length=100, blank=True)
    file_type = models.CharField(max_length=100, blank=True)
    file_size = models.IntegerField(blank=True, null=True) # size of the file in bytes
    file_private = models.BooleanField(default=True) # True if the file is private to the user, False if it is public
    file_path = models.CharField(max_length=100, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    
    def __str__(self):
        return f"{self.datastore_id} contains {self.file.name}"








        
