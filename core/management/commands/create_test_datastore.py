import random
import base64
import logging
from django.core.management.base import BaseCommand
from django.core.files.base import ContentFile
from django.utils import timezone
from django.db import transaction
from itertools import cycle

from core.models import ByteBridgeInstance, DataStore, Bucket, Object

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    """
    Management command to create test datastore with buckets and objects.
    
    This command creates a test datastore with sample buckets and objects
    for testing the NeuroController integration.
    """
    help = 'Create a test datastore with buckets and objects'

    def add_arguments(self, parser):
        parser.add_argument(
            '--instance',
            type=str,
            required=True,
            help='UUID of the ByteBridge instance for the datastore'
        )
        parser.add_argument(
            '--name',
            type=str,
            default='Test Datastore',
            help='Name for the test datastore'
        )
        parser.add_argument(
            '--buckets',
            type=int,
            default=3,
            help='Number of buckets to create'
        )
        parser.add_argument(
            '--objects',
            type=int,
            default=5,
            help='Number of objects per bucket'
        )
        parser.add_argument(
            '--permission',
            type=str,
            choices=['private', 'public', 'community'],
            default='private',
            help='Permission type for the datastore'
        )

    def handle(self, *args, **options):
        """Execute the command"""
        try:
            # Get instance
            try:
                instance = ByteBridgeInstance.objects.get(id=options['instance'])
            except ByteBridgeInstance.DoesNotExist:
                self.stdout.write(self.style.ERROR(f"ByteBridge instance with ID {options['instance']} not found"))
                self.stdout.write("Run 'python manage.py register_with_neurocontroller list' to see available instances")
                return
            
            # Create datastore
            with transaction.atomic():
                datastore = DataStore.objects.create(
                    name=options['name'],
                    instance=instance,
                    owner=instance.owner,
                    permission_type=options['permission'],
                    description="Test datastore created by management command",
                    created_at=timezone.now()
                )
                
                self.stdout.write(self.style.SUCCESS(
                    f"Created datastore: {datastore.name} (ID: {datastore.id})"
                ))
                self.stdout.write(
                    f"Permission type: {options['permission']}"
                )
                
                # Create buckets with cycling permissions: community -> public -> private -> repeat
                bucket_count = options['buckets']
                object_count = options['objects']
                
                # Setup permission cycles
                permission_cycle = cycle(['community', 'public', 'private'])
                
                for i in range(bucket_count):
                    # Get next permission in cycle
                    bucket_permission = next(permission_cycle)
                    
                    bucket = Bucket.objects.create(
                        name=f"Test Bucket {i+1}",
                        datastore=datastore,
                        owner=instance.owner,
                        is_collection=(i % 2 == 0),  # Alternate between true/false
                        permission_type=bucket_permission,
                        created_at=timezone.now()
                    )
                    
                    self.stdout.write(
                        f"Created bucket: {bucket.name} (ID: {bucket.id}, Permission: {bucket_permission})"
                    )
                    
                    # Create objects in bucket with the same permission cycle
                    object_permission_cycle = cycle(['community', 'public', 'private'])
                    
                    # Create objects in bucket
                    for j in range(object_count):
                        # Get next permission for this object
                        object_permission = next(object_permission_cycle)
                        
                        # Create files with different types
                        file_type = random.choice(['txt', 'json', 'csv', 'html', 'jpg', 'png'])
                        
                        # Generate test content
                        if file_type == 'txt':
                            name = f"document_{j+1}.txt"
                            content = f"This is test document {j+1} in bucket {bucket.name}.\n"
                            content += "Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n"
                            content_type = 'text/plain'
                            data = content.encode('utf-8')
                        elif file_type == 'json':
                            name = f"data_{j+1}.json"
                            content = f'{{"id": {j+1}, "name": "Test Object", "bucket": "{bucket.name}"}}'
                            content_type = 'application/json'
                            data = content.encode('utf-8')
                        elif file_type == 'csv':
                            name = f"data_{j+1}.csv"
                            content = "id,name,value\n"
                            content += f"{j+1},Item {j+1},100\n"
                            content += f"{j+2},Item {j+2},200\n"
                            content_type = 'text/csv'
                            data = content.encode('utf-8')
                        elif file_type == 'html':
                            name = f"page_{j+1}.html"
                            content = f"<html><body><h1>Test Page {j+1}</h1><p>In bucket {bucket.name}</p></body></html>"
                            content_type = 'text/html'
                            data = content.encode('utf-8')
                        elif file_type == 'jpg':
                            name = f"image_{j+1}.jpg"
                            # 1x1 pixel JPG
                            data = base64.b64decode('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==')
                            content_type = 'image/jpeg'
                        elif file_type == 'png':
                            name = f"image_{j+1}.png"
                            # 1x1 pixel PNG
                            data = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC')
                            content_type = 'image/png'
                        
                        # Create Object with the cycled permission type
                        obj = Object.objects.create(
                            name=name,
                            bucket=bucket,
                            content_type=content_type,
                            size=len(data),
                            checksum="".join(random.choices("0123456789abcdef", k=32)),
                            created_at=timezone.now(),
                            file=ContentFile(data, name=name),
                            permission_type=object_permission  # Set object-level permission
                        )
                        
                        # Add metadata for certain types
                        if hasattr(obj, 'type_metadata'):
                            if file_type == 'jpg' or file_type == 'png':
                                obj.type_metadata = {
                                    'width': 1,
                                    'height': 1,
                                    'format': file_type.upper()
                                }
                            elif file_type == 'csv':
                                obj.type_metadata = {
                                    'rows': 3,
                                    'columns': 3,
                                    'headers': ['id', 'name', 'value']
                                }
                            obj.save()
                            
                        self.stdout.write(
                            f"  Created object: {obj.name} ({file_type}) "
                            f"in bucket {bucket.name}, Permission: {object_permission}"
                        )
            
            # Show the effective permissions (inheritance chain)
            self.stdout.write("\nEffective Permission Structure:")
            self.stdout.write(f"DataStore: {datastore.name} - {datastore.permission_type}")
            
            for bucket in datastore.buckets.all():
                eff_bucket_perm = bucket.get_effective_permission()
                self.stdout.write(f"  ├── Bucket: {bucket.name} - {bucket.permission_type} (Effective: {eff_bucket_perm})")
                
                for obj in bucket.stored_objects.all():
                    eff_obj_perm = obj.get_effective_permission()
                    self.stdout.write(f"  │   ├── Object: {obj.name} - {obj.permission_type} (Effective: {eff_obj_perm})")
            
            self.stdout.write(self.style.SUCCESS(
                f"\nSuccessfully created test datastore with {bucket_count} buckets and {bucket_count * object_count} objects"
            ))
                
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error: {str(e)}"))
            logger.exception(f"Error in create_test_datastore command: {str(e)}")