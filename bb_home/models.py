import os
import uuid
from django.db import models
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.contrib.auth.models import User



# function to return the relative path inside the datastore directory
def get_datastore_path(instance, filename):
    ds_user_id_path = os.path.join(str(instance.datastore_id), str(instance.user.id))  
    return os.path.join(ds_user_id_path, filename)  

class UserDatastore(models.Model):
    """ Model to store a persistent datastore_id and user_id for each user """
    username = models.CharField(max_length=100, blank=True)
    password = models.CharField(max_length=100, blank=True)
    user_id = models.OneToOneField(User, on_delete=models.CASCADE)
    datastore_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    def __str__(self):
        return f"Datastore for {self.user_id}: {self.datastore_id}"



class UploadedFileModel(models.Model):
    """ Model to store a persistent file upload path with datastore id and user id for each user """
    datastore_id = models.UUIDField(default=uuid.uuid4, editable=False)
    #user_id = models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE) # ForeignKey to the User model
    datastore_storage = FileSystemStorage(location=settings.DATASTORE['default']['PATH']) #/home/areena/bytebridge/bytebridge/datastore
    file = models.FileField(upload_to=get_datastore_path, storage=datastore_storage, blank=True, null=True)
    file_type = models.CharField(max_length=100, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.datastore_id} contains {self.file.name}"
