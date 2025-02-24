import os
import uuid
from django.db import models
from django.conf import settings
from django.core.files.storage import FileSystemStorage



# function to return the relative path inside the datastore directory
'''def get_datastore_path(instance, filename):
    user_ds_path = os.path.join(str(instance.user_id), str(instance.datastore_id))
    user_ds_bucket_path = os.path.join(user_ds_path, str(instance.bucket_id))
    return os.path.join(user_ds_bucket_path, str(filename))'''



class UserDatastore(models.Model):
    """ Model to store a persistent datastore_id for each user created on an instance of BB """

    username = models.CharField(max_length=100, blank=True)
    password = models.CharField(max_length=100, blank=True)
    user_id = models.IntegerField(blank=True, null=True) # ForeignKey to the User model
    datastore_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    datastore_name = models.CharField(max_length=100, blank=True)
    ds_default = models.BooleanField(default=True)
    datastore_private = models.BooleanField(default=True) # True if the datastore is private to the user, False if it is public
    instance_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False) 
    created_at = models.DateTimeField(auto_now_add=True)
    

    def __str__(self):
        return f"Datastore for {self.instance_id}: {self.datastore_id}"



class UserBucket(models.Model):
    """ Model to store a persistent datastore_id for each user created on an instance of BB """

    username = models.CharField(max_length=100, blank=True)
    password = models.CharField(max_length=100, blank=True)
    user_id = models.IntegerField(blank=True, null=True) 
    datastore_id = models.ForeignKey(UserDatastore, on_delete=models.CASCADE) # ForeignKey to the UserDatastore model
    datastore_name = models.CharField(max_length=100, blank=True)
    datastore_private = models.BooleanField(default=True) # True if the datastore is private to the user, False if it is public
    bucket_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    bucket_name = models.CharField(max_length=100, blank=True)
    ds_default = models.BooleanField(default=True)
    bucket_default = models.BooleanField(default=True)
    bucket_private = models.BooleanField(default=True) # True if the bucket is private to the user, False if it is public
    instance_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return f"Bucket for {self.instance_id}: {self.bucket_id}"


class UploadedFileModel(models.Model):
    """ Model to store a persistent file upload path with datastore id and user id for each user with privacy settings """
    
    user_id = models.IntegerField(blank=True, null=True)
    datastore_id = models.CharField(max_length=200, blank=True) # ForeignKey to the UserDatastore model
    bucket_id = models.CharField(max_length=200, blank=True) # ForeignKey to the UserBucket model
    file_name = models.CharField(max_length=100, blank=True)
    file_size = models.IntegerField(blank=True, null=True) # size of the file in bytes
    file_type = models.CharField(max_length=100, blank=True)
    file_private = models.BooleanField(default=True) # True if the file is private to the user, False if it is public
    file_path = models.CharField(max_length=100, blank=True) # relative path to the file inside the datastore directory
    uploaded_at = models.DateTimeField(auto_now_add=True)

    
    def __str__(self):
        return f"{self.datastore_id} contains {self.file.name}"








        
