from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

@receiver(user_logged_in)
def create_user_datastore(sender, request, user, **kwargs):
    """Ensure each logged-in user has a UserDataStore entry."""
    datastore, created = UserDataStore.objects.get_or_create(user=user)
    if created:
        print(f"New datastore created for user {user.username}")
    else:
        print(f"User {user.username} already has a datastore.")
