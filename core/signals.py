import uuid
import logging
from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver
from django.apps import apps

ByteBridgeInstance = apps.get_model('core', 'ByteBridgeInstance')
Object = apps.get_model('core', 'Object')

def get_metadata_service():
    from core.src.models import get_metadata_service
    return get_metadata_service()

logger = logging.getLogger(__name__)

@receiver(pre_save, sender=ByteBridgeInstance)
def set_instance_uuid(sender, instance, **kwargs):
    """
    Signal handler to ensure each ByteBridgeInstance has a unique UUID.
    This runs before the model is saved to the database.
    """
    if not instance.instance_identifier:
        instance.instance_identifier = str(uuid.uuid4())
        logger.info(f"Generated new UUID for ByteBridge instance: {instance.name}")

@receiver(post_save, sender=Object)
def extract_object_metadata(sender, instance, created, **kwargs):
    """
    Signal handler to extract metadata when an Object is created.
    """
    if not created or not instance.file:
        return
        
    metadata_service = get_metadata_service()
    metadata_service.extract_metadata(instance.id)