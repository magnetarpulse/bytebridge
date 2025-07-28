import logging
import uuid
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from django.conf import settings

from core.models import ByteBridgeInstance
from core.src.authentication.services import ByteBridgeRegistrationService

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    """
    Management command to register a ByteBridge instance with NeuroController.
    
    This command can either register an existing instance or create a new test
    instance for registration. The registration process includes cryptographic
    authentication and may require 2FA approval.
    """
    help = 'Register a ByteBridge instance with NeuroController'

    def add_arguments(self, parser):
        """Add command-line arguments"""
        # Create subcommands
        subparsers = parser.add_subparsers(dest='command', help='Command to execute')
        
        # Register existing instance
        register_parser = subparsers.add_parser('register', help='Register an existing instance')
        register_parser.add_argument(
            '--id',
            type=str,
            required=True,
            dest='instance_id',
            help='UUID of the ByteBridge instance to register'
        )
        
        # Create test instance and register it
        create_parser = subparsers.add_parser('create-and-register', help='Create a test instance and register it')
        create_parser.add_argument(
            '--name',
            type=str,
            default='Test ByteBridge Instance',
            help='Name for the test instance'
        )
        create_parser.add_argument(
            '--user',
            type=int,
            required=True,
            help='User ID to set as the owner of the instance'
        )
        create_parser.add_argument(
            '--host',
            type=str,
            default=settings.API_HOST,
            help='Hostname for the instance (defaults to settings.API_HOST)'
        )
        create_parser.add_argument(
            '--port',
            type=int,
            default=int(settings.API_PORT),
            help='Port for the instance (defaults to settings.API_PORT)'
        )
        create_parser.add_argument(
            '--permission',
            type=str,
            choices=['private', 'public', 'community'],
            default='private',
            help='Permission type for the instance (defaults to private)'
        )
        
        # List existing instances
        subparsers.add_parser('list', help='List all existing ByteBridge instances')

    def handle(self, *args, **options):
        """Execute the command"""
        command = options.get('command')
        
        if command == 'register':
            self._register_instance(options['instance_id'])
        elif command == 'create-and-register':
            self._create_and_register_instance(options)
        elif command == 'list':
            self._list_instances()
        else:
            self.stdout.write(self.style.ERROR("Please specify a subcommand. Use --help for options."))

    def _register_instance(self, instance_id):
        """Register an existing ByteBridge instance"""
        try:
            instance = ByteBridgeInstance.objects.get(id=instance_id)
            self.stdout.write(f"Registering instance: {instance.name} (ID: {instance_id})")
            
            # Check if already registered
            if instance.is_registered:
                self.stdout.write(self.style.WARNING(
                    f"Instance '{instance.name}' is already marked as registered. Continuing anyway."
                ))
            
            # Perform registration
            service = ByteBridgeRegistrationService()
            success, error = service.register_instance(instance)
            
            if success:
                self.stdout.write(self.style.SUCCESS(
                    f"Successfully registered instance '{instance.name}' with NeuroController!"
                ))
            else:
                self.stdout.write(self.style.ERROR(
                    f"Registration failed: {error or 'Unknown error'}"
                ))
        
        except ByteBridgeInstance.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Instance with ID {instance_id} not found"))
            self.stdout.write(f"Use 'python manage.py register_with_neurocontroller list' to see all instances")
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error: {str(e)}"))
            logger.exception(f"Error in register_instance command: {str(e)}")

    def _create_and_register_instance(self, options):
        """Create a test instance and register it"""
        try:
            # Get user
            try:
                user = User.objects.get(id=options['user'])
            except User.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"User with ID {options['user']} not found"))
                self.stdout.write("Available users:")
                for user in User.objects.all():
                    self.stdout.write(f"  - ID: {user.id}, Username: {user.username}")
                return
                
            name = options['name']
            host = options['host']
            port = options['port']
            permission_type = options['permission']
            
            # Create instance
            with transaction.atomic():
                instance = ByteBridgeInstance.objects.create(
                    name=name,
                    instance_identifier=str(uuid.uuid4()),
                    host=host,
                    port=port,
                    owner=user,
                    description="Test instance created by management command",
                    last_heartbeat=timezone.now(),
                    permission_type=permission_type
                )
                
            self.stdout.write(self.style.SUCCESS(
                f"Created test instance: {instance.name} (ID: {instance.id})"
            ))
            self.stdout.write(
                f"Permission type: {permission_type}"
            )
            
            # Now register it
            self.stdout.write("Registering with NeuroController...")
            service = ByteBridgeRegistrationService()
            success, error = service.register_instance(instance)
            
            if success:
                self.stdout.write(self.style.SUCCESS(
                    f"Successfully registered instance '{instance.name}' with NeuroController!"
                ))
                self.stdout.write(f"Instance ID: {instance.id}")
                self.stdout.write(f"Instance identifier: {instance.instance_identifier}")
                self.stdout.write(f"Permission type: {instance.permission_type}")
                self.stdout.write(f"NeuroController's public singing key: {instance.neurocontroller_Ed25519_public_key}")
                self.stdout.write(f"NeuroController's public encryption key: {instance.neurocontroller_X25519_public_key}")
            else:
                self.stdout.write(self.style.ERROR(
                    f"Registration failed: {error or 'Unknown error'}"
                ))
        
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error: {str(e)}"))
            logger.exception(f"Error in create_and_register_instance command: {str(e)}")
    
    def _list_instances(self):
        """List all ByteBridge instances"""
        # Get all instance IDs first (this prevents UUID parsing errors)
        instance_ids = list(ByteBridgeInstance.objects.values_list('id', flat=True))
        self.stdout.write(self.style.SUCCESS(f"Found {len(instance_ids)} ByteBridge instances:"))
        self.stdout.write("\nID | Name | Owner | Registered | Permission | Host:Port")
        self.stdout.write("---------------------------------------------------")
        
        valid_instances = 0
        error_count = 0
        
        # Process each instance ID individually
        for instance_id in instance_ids:
            try:
                # Fetch each instance separately to isolate potential errors
                try:
                    instance = ByteBridgeInstance.objects.get(pk=instance_id)
                except ByteBridgeInstance.DoesNotExist:
                    continue
                    
                # Display instance info
                try:
                    registered = "✓" if instance.is_registered else "✗"
                    owner_username = instance.owner.username if instance.owner else "No owner"
                    permission = instance.permission_type if hasattr(instance, 'permission_type') else 'private'
                    self.stdout.write(f"{instance_id} | {instance.name} | {owner_username} | {registered} | {permission} | {instance.host}:{instance.port}")
                    valid_instances += 1
                except Exception as e:
                    self.stdout.write(self.style.WARNING(
                        f"Error displaying instance {instance_id}: {str(e)}"
                    ))
                    error_count += 1
                    
            except Exception as e:
                self.stdout.write(self.style.WARNING(
                    f"Skipped instance with ID {instance_id} due to error: {str(e)}"
                ))
                error_count += 1
        
        if error_count > 0:
            self.stdout.write(self.style.WARNING(
                f"\nWarning: {error_count} instances had errors and were not displayed properly."
            ))
        
        if valid_instances == 0:
            self.stdout.write(self.style.WARNING("\nNo valid ByteBridge instances found"))
            self.stdout.write("To create one, use: python manage.py register_with_neurocontroller create-and-register --user=<user_id>")