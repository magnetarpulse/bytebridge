import logging
import base64
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from core.models import ByteBridgeInstance
from core.src.authentication.services.key_management_service import KeyManagementService

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Check key compatibility between ByteBridge and NeuroController'

    def add_arguments(self, parser):
        parser.add_argument('--instance-id', type=str, help='The ByteBridge instance ID to check')
        parser.add_argument('--neuro-key', type=str, help='The NeuroController public key to compare with')

    def handle(self, *args, **options):
        instance_id = options['instance_id']
        neuro_key = options['neuro_key']
        
        # First, get our server public key
        try:
            server_keypair = KeyManagementService.get_or_create_ed25519_signing_keypair()
            server_signing_public_key = server_keypair.public_key
            self.stdout.write(f"ByteBridge server public key: {server_signing_public_key}")
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Failed to retrieve server keypair: {e}"))
            return
            
        # If an instance ID was provided, check that instance's stored NeuroController public key
        if instance_id:
            try:
                instance = ByteBridgeInstance.objects.get(instance_identifier=instance_id)
                stored_neuro_key = instance.neurocontroller_Ed25519_public_key
                self.stdout.write(f"Stored NeuroController public key for instance {instance_id}: {stored_neuro_key}")
                
                # Compare with provided key if given
                if neuro_key and stored_neuro_key != neuro_key:
                    self.stdout.write(self.style.WARNING(
                        f"MISMATCH! The stored key doesn't match the provided key.\n"
                        f"Stored: {stored_neuro_key}\n"
                        f"Provided: {neuro_key}"
                    ))
                elif neuro_key:
                    self.stdout.write(self.style.SUCCESS("The keys match!"))
                    
            except ByteBridgeInstance.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"No instance found with ID: {instance_id}"))
        
        # List all instances and their stored NeuroController public keys
        self.stdout.write("\nAll ByteBridge instances and their NeuroController public keys:")
        for instance in ByteBridgeInstance.objects.all():
            self.stdout.write(
                f"Instance {instance.instance_identifier} ({instance.name}):\n"
                f"   NeuroController Signing Key: {instance.neurocontroller_Ed25519_public_key or 'Not registered'}"
            )