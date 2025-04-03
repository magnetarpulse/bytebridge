from django.db import models
import uuid


# Create your models here.

class Datastores(models.Model):
    """ Model to store a persistent datastore_id for each user created on an instance of BB """

    owner_id = models.IntegerField(blank=True, null=False) 
    instance_id = models.UUIDField(default=uuid.uuid4, editable=False) 
    datastore_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    datastore_name = models.CharField(max_length=100, blank=False)
    private_permissions = models.BooleanField(default=True) # True if the datastore is private to the user, False if it is public
    default = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)
    accessed_at = models.DateTimeField(null=False, blank=False)

    def __str__(self):
        return f"Datastore for {self.instance_id}: {self.datastore_id}"


class Buckets(models.Model):
    """ Model to store a persistent datastore_id for each user created on an instance of BB """

    owner_id = models.IntegerField(blank=False, null=False) 
    datastore_id = models.ForeignKey(Datastores, on_delete=models.CASCADE, db_column="datastore_id") # ForeignKey to the UserDatastore model
    
    bucket_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    bucket_name = models.CharField(max_length=100, blank=False)
    private_permissions = models.BooleanField(default=True) # True if the bucket is private to the user, False if it is public
    default = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)
    accessed_at = models.DateTimeField(null=False, blank=False)
    
    def __str__(self):
        return f"Bucket for {self.instance_id}: {self.bucket_id}"


class Objects(models.Model):
    """ Model to store a persistent file upload path with datastore id and user id for each user with privacy settings """
    
    file_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    owner_id = models.IntegerField(blank=False, null=False)
    datastore_id = models.ForeignKey(Datastores, on_delete=models.CASCADE, db_column="datastore_id") # ForeignKey to the UserDatastore model
    bucket_id = models.ForeignKey(Buckets, on_delete=models.CASCADE, db_column="bucket_id") # ForeignKey to the UserBucket model

    file_name = models.CharField(max_length=100, blank=False)
    file_type = models.CharField(max_length=100, blank=False)
    file_size = models.IntegerField(blank=False, null=False) # size of the file in bytes
    private_permissions = models.BooleanField(default=True) # True if the file is private to the user, False if it is public
    file_path = models.CharField(max_length=200, blank=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    modified_at = models.DateTimeField(auto_now=True)
    accessed_at = models.DateTimeField(null=False, blank=False)

    def __str__(self):
        return f"{self.datastore_id} contains {self.file.name}"