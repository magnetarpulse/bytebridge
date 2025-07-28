import uuid
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.contrib.auth.models import User
from .models import UserProfile

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        # Create profile for new user
        if not hasattr(instance, 'userprofile'):
            UserProfile.objects.create(
                user=instance, 
                auth_token=uuid.uuid4().hex,
                is_admin=instance.is_staff
            )

# Also update existing superusers without profiles
@receiver(post_save, sender=User)
def update_user_profile(sender, instance, **kwargs):
    if instance.is_superuser and not hasattr(instance, 'userprofile'):
        UserProfile.objects.create(
            user=instance, 
            auth_token=uuid.uuid4().hex,
            is_admin=True
        )