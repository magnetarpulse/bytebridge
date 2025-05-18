from django.db import models

# Create your models here.
# data_management/models.py

import uuid
from django.db import models

class Datastore(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    password = models.CharField(max_length=255)
    instance_id = models.UUIDField()

    def __str__(self):
        return str(self.id)

