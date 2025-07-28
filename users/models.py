from django.db import models
from django.contrib.auth.models import User

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    auth_token = models.CharField(max_length=64, blank=True, null=True)
    is_admin = models.BooleanField(default=False)
    
    def __str__(self):
        return f'{self.user.username} Profile'