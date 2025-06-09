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
