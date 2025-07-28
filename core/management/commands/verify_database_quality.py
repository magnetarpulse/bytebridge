import uuid
import os
from datetime import datetime, timedelta
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Q, Count, F
from django.utils import timezone
from core.models import ByteBridgeInstance, DataStore, Bucket, Object
import django.db.transaction as transaction
from django.core.paginator import Paginator
import logging
import time

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Verifies database quality and integrity'

    VERIFICATION_HANDLERS = {
        'uuids': 'verify_uuids',
        'orphans': 'verify_orphaned_records',
        'integrity': 'verify_data_integrity',
        'permissions': 'verify_permissions',
        'files': 'verify_file_integrity',
    }

    def add_arguments(self, parser):
        parser.add_argument(
            '--fix',
            action='store_true',
            help='Attempt to fix issues automatically where possible',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Show detailed information about issues',
        )
        parser.add_argument(
            '--section',
            type=str,
            help='Run only a specific verification section (uuids, orphans, integrity, permissions, files)',
        )

    def handle(self, *args, **options):
        log_level = logging.DEBUG if options['verbose'] else logging.INFO
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s [%(levelname)s] %(message)s',
        )

        try:
            self.fix = options['fix']
            self.verbose = options['verbose']
            self.section = options.get('section')
            self._print_header("ByteBridge Database Quality Verification")
            
            all_issues = {}
            sections = [self.section] if self.section else self.VERIFICATION_HANDLERS.keys()
            
            # Run selected verification checks
            for section in sections:
                if section in self.VERIFICATION_HANDLERS:
                    handler_name = self.VERIFICATION_HANDLERS[section]
                    handler = getattr(self, handler_name)
                    section_issues = handler()
                    
                    # If we fixed issues in this section and there were issues before fixing
                    if self.fix and section_issues and any(issue.get('fixable', False) for issue in section_issues):
                        self._print_info(f"Verifying {section} after applying fixes...")
                        
                        # Re-run the verification to get updated results
                        section_issues = handler(skip_fixes=True)
                    
                    all_issues[f'{section}_issues'] = section_issues
                    
            total_issues = sum([len(issues) for issues in all_issues.values()])

            self._print_summary(total_issues, all_issues)
            if total_issues > 0:
                self._print_help_text()
            
        except Exception as e:
            logger.exception(f"Verification failed with error: {e}")
            self._print_error(f"Verification failed: {e}")

    def _print_header(self, title):
        """Print a professional-looking header."""
        terminal_width = os.get_terminal_size().columns
        border = "═" * terminal_width
        
        self.stdout.write("\n" + self.style.SUCCESS(border))
        
        padding = (terminal_width - len(title) - 4) // 2
        title_line = "║" + " " * padding + title + " " * (terminal_width - len(title) - padding - 4) + "║"
        self.stdout.write(self.style.SUCCESS(title_line))
        
        self.stdout.write(self.style.SUCCESS(border) + "\n")

    def _print_section_header(self, title):
        """Print a section header."""
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("┌" + "─" * (terminal_width - 2) + "┐"))
        
        padding = (terminal_width - len(title) - 4) // 2
        title_line = "│" + " " * padding + title + " " * (terminal_width - len(title) - padding - 2) + "│"
        self.stdout.write(self.style.SUCCESS(title_line))
        
        self.stdout.write(self.style.SUCCESS("└" + "─" * (terminal_width - 2) + "┘"))

    def _print_success(self, message):
        """Print a success message."""
        self.stdout.write(self.style.SUCCESS(f"  ✅ {message}"))

    def _print_warning(self, message):
        """Print a warning message."""
        self.stdout.write(self.style.WARNING(f"  ⚠️  {message}"))

    def _print_error(self, message):
        """Print an error message."""
        self.stdout.write(self.style.ERROR(f"  ❌ {message}"))

    def _print_info(self, message):
        """Print an info message."""
        self.stdout.write(f"  ℹ️  {message}")

    def _print_progress(self, current, total, message=""):
        """Print a progress indicator with green coloring."""
        percentage = (current / total) * 100 if total > 0 else 0
        bar_length = 30

        filled_length = int(bar_length * current // total)
        filled_bar = self.style.SUCCESS('█' * filled_length)

        empty_bar = '░' * (bar_length - filled_length)
        bar = filled_bar + empty_bar

        progress_text = f"  [{bar}] {current}/{total} ({percentage:.1f}%) {message}"
        self.stdout.write(progress_text, ending='\r')
        
        if current == total:
            self.stdout.write("\n")

    def _print_summary(self, total_issues, all_issues):
        """Print a summary of verification results."""
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + "─" * terminal_width)
        
        if total_issues == 0:
            self.stdout.write(self.style.SUCCESS("\n📊 SUMMARY: No issues found! Database quality is excellent."))
        else:
            self.stdout.write(self.style.ERROR(f"\n📊 SUMMARY: Found {total_issues} issues that need attention"))
            
            self.stdout.write("\n  " + "─" * (terminal_width - 4))
            self.stdout.write(f"  {'SECTION':<20} {'ISSUES':<10} {'STATUS':<15}")
            self.stdout.write("  " + "─" * (terminal_width - 4))
            
            for section, issues in all_issues.items():
                section_name = section.replace("_issues", "").replace("_", " ").capitalize()
                count = len(issues)
                
                if count == 0:
                    status = self.style.SUCCESS("✓ PASS")
                elif any(issue.get('fixable', False) for issue in issues):
                    status = self.style.WARNING("⚠ FIXABLE")
                else:
                    status = self.style.ERROR("✗ CRITICAL")
                    
                self.stdout.write(f"  {section_name:<20} {count:<10} {status:<15}")
            
            self.stdout.write("  " + "─" * (terminal_width - 4))

    def _print_help_text(self):
        """Print help text for fixing issues."""
        self.stdout.write(self.style.SUCCESS("\n📋 NEXT STEPS:"))
        self.stdout.write("  • To fix issues automatically: --fix")
        self.stdout.write("  • To see detailed information: --verbose")
        self.stdout.write("  • To run specific section: --section [name]")
        
        self.stdout.write("\n  Available sections:")
        sections = {
            'uuids': 'Verify UUID formatting and uniqueness',
            'orphans': 'Check for orphaned or disconnected records',
            'integrity': 'Verify data integrity constraints',
            'permissions': 'Check permission settings',
            'files': 'Verify file existence and integrity',
        }
        
        for section, desc in sections.items():
            self.stdout.write(f"    • {section:<10} - {desc}")

    def verify_uuids(self, skip_fixes=False):
        """Verify that all UUIDs are properly formatted."""
        self._print_section_header("UUID Verification")
        issues = []
    
        self._print_info("Analyzing instance UUIDs...")
        
        # Check ByteBridgeInstance UUIDs (both id and instance_identifier)
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT id, instance_identifier, name 
                FROM core_bytebridgeinstance
            """)
            rows = cursor.fetchall()
            
            total_instances = len(rows)
            self._print_info(f"Found {total_instances} instances to verify")
            
            for i, row in enumerate(rows):
                record_id, instance_id, name = row
                
                if self.verbose or i % 50 == 0 or i == total_instances - 1:
                    self._print_progress(i + 1, total_instances)
                
                # Check primary key UUID (id)
                try:
                    uuid.UUID(str(record_id))
                except ValueError:
                    issue = {
                        'model': 'ByteBridgeInstance',
                        'id': record_id,
                        'field': 'id',
                        'value': record_id,
                        'issue': 'Invalid UUID format for primary key',
                        'fixable': False,
                    }
                    issues.append(issue)
                    if self.verbose:
                        self._print_warning(f"Instance primary key {record_id}: Invalid UUID format")
                
                # Check instance_identifier UUID
                if not instance_id:
                    issue = {
                        'model': 'ByteBridgeInstance',
                        'id': record_id,
                        'field': 'instance_identifier',
                        'value': instance_id,
                        'issue': 'Missing UUID',
                        'fixable': True,
                    }
                    issues.append(issue)
                    if self.verbose:
                        self._print_warning(f"Instance {record_id} ({name}): Missing instance_identifier UUID")
                else:
                    try:
                        uuid.UUID(instance_id)
                    except ValueError:
                        issue = {
                            'model': 'ByteBridgeInstance',
                            'id': record_id,
                            'field': 'instance_identifier',
                            'value': instance_id,
                            'issue': 'Invalid UUID format',
                            'fixable': True,
                        }
                        issues.append(issue)
                        if self.verbose:
                            self._print_warning(f"Instance {record_id} ({name}): Invalid instance_identifier UUID format - {instance_id}")
    
            # Also check for duplicate instance_identifiers (should be unique)
            self._print_info("Checking for duplicate instance identifiers...")
            cursor.execute("""
                SELECT instance_identifier, COUNT(*) 
                FROM core_bytebridgeinstance 
                GROUP BY instance_identifier 
                HAVING COUNT(*) > 1
            """)
            duplicates = cursor.fetchall()
            
            if duplicates:
                self._print_warning(f"Found {len(duplicates)} duplicate instance identifiers")
            
            for dup_id, count in duplicates:
                cursor.execute("""
                    SELECT id, name 
                    FROM core_bytebridgeinstance 
                    WHERE instance_identifier = %s
                """, [dup_id])
                instances = cursor.fetchall()
                
                for i, (instance_id, name) in enumerate(instances):
                    # First occurrence is fine, others are duplicates
                    if i > 0:
                        issue = {
                            'model': 'ByteBridgeInstance',
                            'id': instance_id,
                            'field': 'instance_identifier',
                            'value': dup_id,
                            'issue': f'Duplicate instance_identifier (used by {count} instances)',
                            'fixable': True,
                        }
                        issues.append(issue)
                        if self.verbose:
                            self._print_warning(f"Instance {instance_id} ({name}): Duplicate instance_identifier - {dup_id}")
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        # Fix issues if requested
        if self.fix and not skip_fixes:
            self.fix_uuid_issues(issues)
        
        # Summary
        if not issues:
            self._print_success("All UUIDs are properly formatted")
        else:
            fixable = sum(1 for i in issues if i.get('fixable', False))
            self._print_error(f"Found {len(issues)} UUID issues ({fixable} automatically fixable)")
            
        return issues
    
    def fix_uuid_issues(self, issues):
        """Fix UUID formatting issues."""
        fixed_count = 0
        
        # Only proceed if there are fixable issues
        fixable_issues = [i for i in issues if i.get('fixable', False)]
        if not fixable_issues:
            self._print_info("No fixable UUID issues found")
            return
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("┌" + "─" * (terminal_width - 2) + "┐"))
        self.stdout.write(self.style.SUCCESS("│" + " UUID Issue Fixes ".center(terminal_width - 2) + "│"))
        self.stdout.write(self.style.SUCCESS("└" + "─" * (terminal_width - 2) + "┘"))
        
        self._print_info(f"Attempting to fix {len(fixable_issues)} UUID issues...")
    
        with transaction.atomic():
            for i, issue in enumerate(fixable_issues):
                if len(fixable_issues) > 10:
                    self._print_progress(i + 1, len(fixable_issues), "fixing")
                
                if issue['model'] == 'ByteBridgeInstance' and issue['field'] == 'instance_identifier':
                    # Get related record count
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "SELECT COUNT(*) FROM core_datastore WHERE instance_id = %s", 
                            [issue['id']]
                        )
                        related_count = cursor.fetchone()[0]
                    
                    if related_count > 0:
                        self._print_warning(f"Can't automatically fix Instance ID {issue['id']} - has {related_count} related datastores")
                        continue
                        
                    # Generate a new UUID
                    new_uuid = str(uuid.uuid4())
                    
                    with connection.cursor() as cursor:
                        cursor.execute(
                            "UPDATE core_bytebridgeinstance SET instance_identifier = %s WHERE id = %s",
                            [new_uuid, issue['id']]
                        )
                        
                    fixed_count += 1
                    self._print_success(f"Fixed Instance ID {issue['id']} - new UUID: {new_uuid}")
            
            terminal_width = os.get_terminal_size().columns
            self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
            
            if fixed_count > 0:
                self._print_success(f"Fixed {fixed_count} UUID issues")
            elif issues:
                self._print_warning("No UUID issues could be fixed automatically")

    def verify_orphaned_records(self, skip_fixes=False):
        """Find orphaned records (records with missing parent references)."""
        self._print_section_header("Orphaned Record Verification")
        issues = []
        start_time = time.time()
        
        self._print_info("Checking for datastores with missing instances...")
        
        # Check for DataStores with non-existent instances
        orphaned_datastores = DataStore.objects.raw("""
            SELECT d.id, d.name 
            FROM core_datastore d 
            LEFT JOIN core_bytebridgeinstance i ON d.instance_id = i.id 
            WHERE i.id IS NULL
        """)
        
        for ds in orphaned_datastores:
            issue = {
                'model': 'DataStore',
                'id': ds.id,
                'field': 'instance_id',
                'issue': 'References non-existent ByteBridgeInstance',
                'fixable': False,
            }
            issues.append(issue)
            if self.verbose:
                self._print_warning(f"DataStore {ds.id} ({ds.name}): References non-existent ByteBridgeInstance")
        
        self._print_info("Checking for buckets with missing datastores...")
        
        # Check for Buckets with non-existent datastores
        orphaned_buckets = Bucket.objects.raw("""
            SELECT b.id, b.name 
            FROM core_bucket b 
            LEFT JOIN core_datastore d ON b.datastore_id = d.id 
            WHERE d.id IS NULL
        """)
        
        for bucket in orphaned_buckets:
            issue = {
                'model': 'Bucket',
                'id': bucket.id,
                'field': 'datastore_id',
                'issue': 'References non-existent DataStore',
                'fixable': False,
            }
            issues.append(issue)
            if self.verbose:
                self._print_warning(f"Bucket {bucket.id} ({bucket.name}): References non-existent DataStore")
        
        self._print_info("Checking for objects with missing buckets...")
        
        # Check for Objects with non-existent buckets
        # Use batch processing for larger tables
        batch_size = 1000
        total_objects = Object.objects.count()
        processed = 0
        
        if total_objects > 0:
            self._print_info(f"Found {total_objects} objects to verify in batches of {batch_size}")
        
        # Process in chunks to avoid memory issues
        for offset in range(0, total_objects, batch_size):
            orphaned_objects = Object.objects.raw(f"""
                SELECT o.id, o.name 
                FROM core_object o 
                LEFT JOIN core_bucket b ON o.bucket_id = b.id 
                WHERE b.id IS NULL
                LIMIT {batch_size} OFFSET {offset}
            """)
            
            processed_before = processed
            
            for obj in orphaned_objects:
                issue = {
                    'model': 'Object',
                    'id': obj.id,
                    'field': 'bucket_id',
                    'issue': 'References non-existent Bucket',
                    'fixable': False,
                }
                issues.append(issue)
                if self.verbose:
                    self._print_warning(f"Object {obj.id} ({obj.name}): References non-existent Bucket")
            
            processed += len(list(orphaned_objects))
            
            if total_objects > batch_size:
                self._print_progress(min(offset + batch_size, total_objects), total_objects)
                
            if processed > processed_before and self.verbose:
                self._print_info(f"Found {processed - processed_before} orphaned objects in this batch")
        
        self._print_info("Checking for records with non-existent owners...")
        
        # Check for records with non-existent owners (User models)
        models_to_check = [
            ('DataStore', 'core_datastore', 'd'),
            ('Bucket', 'core_bucket', 'b'),
            ('ByteBridgeInstance', 'core_bytebridgeinstance', 'i')
        ]
        
        for model_name, table_name, alias in models_to_check:
            query = f"""
                SELECT {alias}.id, {alias}.name 
                FROM {table_name} {alias}
                LEFT JOIN auth_user u ON {alias}.owner_id = u.id 
                WHERE {alias}.owner_id IS NOT NULL AND u.id IS NULL
            """
            
            with connection.cursor() as cursor:
                cursor.execute(query)
                rows = cursor.fetchall()
                
                if rows and self.verbose:
                    self._print_info(f"Found {len(rows)} {model_name} records with invalid owners")
                    
                for row in rows:
                    record_id, name = row
                    issue = {
                        'model': model_name,
                        'id': record_id,
                        'field': 'owner_id',
                        'issue': 'References non-existent User',
                        'fixable': False,
                    }
                    issues.append(issue)
                    if self.verbose:
                        self._print_warning(f"{model_name} {record_id} ({name}): References non-existent Owner User")
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        elapsed_time = time.time() - start_time
        if not issues:
            self._print_success(f"No orphaned records found (completed in {elapsed_time:.2f}s)")
        else:
            self._print_error(f"Found {len(issues)} orphaned records (completed in {elapsed_time:.2f}s)")
            
        return issues
    
    def verify_data_integrity(self, skip_fixes=False):
        """Check for data integrity issues like duplicate names, etc."""
        self._print_section_header("Data Integrity Verification")
        issues = []
        start_time = time.time()
        
        self._print_info("Checking for duplicate resource names...")
        
        # Check for duplicate DataStore names within the same instance
        duplicate_datastores = DataStore.objects.values(
            'instance_id', 'name'
        ).annotate(
            name_count=Count('name')
        ).filter(name_count__gt=1)
        
        for dup in duplicate_datastores:
            datastores = DataStore.objects.filter(
                instance_id=dup['instance_id'], 
                name=dup['name']
            )
            
            for ds in datastores:
                issue = {
                    'model': 'DataStore',
                    'id': ds.id,
                    'field': 'name',
                    'value': ds.name,
                    'issue': f'Duplicate name within instance {ds.instance_id}',
                    'fixable': False,
                }
                issues.append(issue)
                if self.verbose:
                    self._print_warning(f"DataStore {ds.id}: Duplicate name \"{ds.name}\" in instance {ds.instance_id}")
        
        # Check for duplicate Bucket names within the same datastore
        duplicate_buckets = Bucket.objects.values(
            'datastore_id', 'name'
        ).annotate(
            name_count=Count('name')
        ).filter(name_count__gt=1)
        
        for dup in duplicate_buckets:
            buckets = Bucket.objects.filter(
                datastore_id=dup['datastore_id'], 
                name=dup['name']
            )
            
            for bucket in buckets:
                issue = {
                    'model': 'Bucket',
                    'id': bucket.id,
                    'field': 'name',
                    'value': bucket.name,
                    'issue': f'Duplicate name within datastore {bucket.datastore_id}',
                    'fixable': False,
                }
                issues.append(issue)
                if self.verbose:
                    self._print_warning(f"Bucket {bucket.id}: Duplicate name \"{bucket.name}\" in datastore {bucket.datastore_id}")
        
        # Check for duplicate Object names within the same bucket
        duplicate_objects = Object.objects.values(
            'bucket_id', 'name'
        ).annotate(
            name_count=Count('name')
        ).filter(name_count__gt=1)
        
        for dup in duplicate_objects:
            objects = Object.objects.filter(
                bucket_id=dup['bucket_id'], 
                name=dup['name']
            )
            
            for obj in objects:
                issue = {
                    'model': 'Object',
                    'id': obj.id,
                    'field': 'name',
                    'value': obj.name,
                    'issue': f'Duplicate name within bucket {obj.bucket_id}',
                    'fixable': False,
                }
                issues.append(issue)
                if self.verbose:
                    self._print_warning(f"Object {obj.id}: Duplicate name \"{obj.name}\" in bucket {obj.bucket_id}")
        
        self._print_info("Checking for empty resource names...")
        
        # Check for empty names
        for model, name in [
            (ByteBridgeInstance, 'Instance'), 
            (DataStore, 'DataStore'),
            (Bucket, 'Bucket'),
            (Object, 'Object')
        ]:
            empty_names = model.objects.filter(Q(name__isnull=True) | Q(name=''))
            
            for record in empty_names:
                issue = {
                    'model': model.__name__,
                    'id': record.id,
                    'field': 'name',
                    'value': getattr(record, 'name', None),
                    'issue': f'Empty or null name',
                    'fixable': True,
                    'fix_value': f'Unnamed {name.lower()} {record.id}',
                }
                issues.append(issue)
                if self.verbose:
                    self._print_warning(f"{name} {record.id}: Empty or null name")
        
        self._print_info("Checking for invalid timestamps...")
        
        # Check for invalid timestamps
        # Allow 1 day in future for time zone differences
        future_cutoff = timezone.now() + timedelta(days=1)  
        past_cutoff = timezone.make_aware(datetime(2020, 1, 1))  
        
        for model, name in [
            (ByteBridgeInstance, 'Instance'), 
            (DataStore, 'DataStore'),
            (Bucket, 'Bucket'),
            (Object, 'Object')
        ]:
            future_records = model.objects.filter(created_at__gt=future_cutoff)
            
            for record in future_records:
                issue = {
                    'model': model.__name__,
                    'id': record.id,
                    'field': 'created_at',
                    'value': record.created_at,
                    'issue': f'Future creation date ({record.created_at})',
                    'fixable': True,
                    'fix_value': timezone.now(),
                }
                issues.append(issue)
                if self.verbose:
                    self._print_warning(f"{name} {record.id}: Future creation date {record.created_at}")
            
            ancient_records = model.objects.filter(created_at__lt=past_cutoff)
            
            for record in ancient_records:
                issue = {
                    'model': model.__name__,
                    'id': record.id,
                    'field': 'created_at',
                    'value': record.created_at,
                    'issue': f'Too old creation date ({record.created_at})',
                    'fixable': False,
                }
                issues.append(issue)
                if self.verbose:
                    self._print_warning(f"{name} {record.id}: Too old creation date {record.created_at}")
        
        self._print_info("Checking for timestamp inconsistencies...")
        
        # Check for last_modified older than created_at in Object model
        objects_with_invalid_dates = Object.objects.filter(last_modified__lt=F('created_at'))
        
        for obj in objects_with_invalid_dates:
            issue = {
                'model': 'Object',
                'id': obj.id,
                'field': 'last_modified',
                'value': obj.last_modified,
                'issue': f'Last modified date ({obj.last_modified}) is before creation date ({obj.created_at})',
                'fixable': True,
                'fix_value': obj.created_at,
            }
            issues.append(issue)
            if self.verbose:
                self._print_warning(f"Object {obj.id}: Last modified date {obj.last_modified} is before creation date {obj.created_at}")
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        # Fix issues if requested
        if self.fix and not skip_fixes:
            self.fix_integrity_issues(issues)
        
        # Summary
        elapsed_time = time.time() - start_time
        if not issues:
            self._print_success(f"No data integrity issues found (completed in {elapsed_time:.2f}s)")
        else:
            fixable = sum(1 for i in issues if i.get('fixable', False))
            self._print_error(f"Found {len(issues)} data integrity issues ({fixable} fixable) (completed in {elapsed_time:.2f}s)")
        
        return issues
    
    def fix_integrity_issues(self, issues):
        """Fix data integrity issues."""
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("┌" + "─" * (terminal_width - 2) + "┐"))
        self.stdout.write(self.style.SUCCESS("│" + " Data Integrity Issue Fixes ".center(terminal_width - 2) + "│"))
        self.stdout.write(self.style.SUCCESS("└" + "─" * (terminal_width - 2) + "┘"))
        
        fixed_count = 0
        future_cutoff = timezone.now() + timedelta(days=1)  
        
        # Only proceed if there are fixable issues
        fixable_issues = [i for i in issues if i.get('fixable', False)]
        if not fixable_issues:
            self._print_info("No fixable data integrity issues found")
            return
        
        self._print_info(f"Attempting to fix {len(fixable_issues)} data integrity issues...")
        
        with transaction.atomic():
            for i, issue in enumerate(fixable_issues):
                if len(fixable_issues) > 10:
                    self._print_progress(i + 1, len(fixable_issues), "fixing")
                
                if not issue['fixable']:
                    continue
                
                model = None
                if issue['model'] == 'ByteBridgeInstance':
                    model = ByteBridgeInstance
                elif issue['model'] == 'DataStore':
                    model = DataStore
                elif issue['model'] == 'Bucket':
                    model = Bucket
                elif issue['model'] == 'Object':
                    model = Object
                
                if model and issue['field'] == 'name' and (issue['value'] is None or issue['value'] == ''):
                    try:
                        record = model.objects.get(id=issue['id'])
                        record.name = issue['fix_value']
                        record.save(update_fields=['name'])
                        fixed_count += 1
                        if self.verbose:
                            self._print_success(f"Fixed {issue['model']} {issue['id']}: Set name to '{issue['fix_value']}'")
                    except model.DoesNotExist:
                        if self.verbose:
                            self._print_warning(f"Couldn't fix {issue['model']} {issue['id']}: Record not found")
                
                elif model and issue['field'] == 'created_at' and issue['value'] > future_cutoff:
                    try:
                        record = model.objects.get(id=issue['id'])
                        record.created_at = timezone.now()
                        record.save(update_fields=['created_at'])
                        fixed_count += 1
                        if self.verbose:
                            self._print_success(f"Fixed {issue['model']} {issue['id']}: Set created_at to current time")
                    except model.DoesNotExist:
                        if self.verbose:
                            self._print_warning(f"Couldn't fix {issue['model']} {issue['id']}: Record not found")
                
                elif issue['model'] == 'Object' and issue['field'] == 'last_modified':
                    try:
                        obj = Object.objects.get(id=issue['id'])
                        obj.last_modified = obj.created_at
                        obj.save(update_fields=['last_modified'])
                        fixed_count += 1
                        if self.verbose:
                            self._print_success(f"Fixed Object {issue['id']}: Set last_modified to match created_at")
                    except Object.DoesNotExist:
                        if self.verbose:
                            self._print_warning(f"Couldn't fix Object {issue['id']}: Record not found")
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        if fixed_count > 0:
            self._print_success(f"Fixed {fixed_count} data integrity issues")
        elif issues:
            self._print_warning("No data integrity issues could be fixed automatically")
    
    def verify_permissions(self, skip_fixes=False):
        """Verify permission settings."""
        self._print_section_header("Permission Settings Verification")
        issues = []
        start_time = time.time()
        
        self._print_info("Checking for invalid DataStore permission types...")
        
        # Get the actual permission choices from the models
        valid_datastore_permissions = [choice[0] for choice in DataStore.PERMISSION_CHOICES]
        
        # Check for invalid permission types in DataStore
        invalid_datastores = DataStore.objects.exclude(permission_type__in=valid_datastore_permissions)
        
        for ds in invalid_datastores:
            issue = {
                'model': 'DataStore',
                'id': ds.id,
                'field': 'permission_type',
                'value': ds.permission_type,
                'issue': f'Invalid permission type (valid options: {", ".join(valid_datastore_permissions)})',
                'fixable': True,
                'fix_value': 'private',  
            }
            issues.append(issue)
            if self.verbose:
                self._print_warning(f"DataStore {ds.id} ({ds.name}): Invalid permission type \"{ds.permission_type}\"")
        
        self._print_info("Checking for invalid Bucket permission types...")
        
        # Check for invalid permission types in Bucket
        valid_bucket_permissions = [choice[0] for choice in DataStore.PERMISSION_CHOICES] + [None, '']
        invalid_buckets = Bucket.objects.exclude(permission_type__in=valid_bucket_permissions)
        
        for bucket in invalid_buckets:
            issue = {
                'model': 'Bucket',
                'id': bucket.id,
                'field': 'permission_type',
                'value': bucket.permission_type,
                'issue': f'Invalid permission type (valid options: {", ".join(str(p) for p in valid_bucket_permissions if p)})',
                'fixable': True,
                'fix_value': 'private',  
            }
            issues.append(issue)
            if self.verbose:
                self._print_warning(f"Bucket {bucket.id} ({bucket.name}): Invalid permission type \"{bucket.permission_type}\"")
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        # Fix issues if requested
        if self.fix and not skip_fixes:
            self.fix_permission_issues(issues)
        
        # Summary
        elapsed_time = time.time() - start_time
        if not issues:
            self._print_success(f"All permission settings are valid (completed in {elapsed_time:.2f}s)")
        else:
            fixable = sum(1 for i in issues if i.get('fixable', False))
            self._print_error(f"Found {len(issues)} permission issues ({fixable} fixable) (completed in {elapsed_time:.2f}s)")
            
        return issues
    
    def fix_permission_issues(self, issues):
        """Fix permission issues."""
        # Show a fix header
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("┌" + "─" * (terminal_width - 2) + "┐"))
        self.stdout.write(self.style.SUCCESS("│" + " Permission Issue Fixes ".center(terminal_width - 2) + "│"))
        self.stdout.write(self.style.SUCCESS("└" + "─" * (terminal_width - 2) + "┘"))
        
        fixed_count = 0
        
        # Only proceed if there are fixable issues
        fixable_issues = [i for i in issues if i.get('fixable', False)]
        if not fixable_issues:
            self._print_info("No fixable permission issues found")
            return
        
        self._print_info(f"Attempting to fix {len(fixable_issues)} permission issues...")
        
        with transaction.atomic():
            for i, issue in enumerate(fixable_issues):
                if len(fixable_issues) > 10:
                    self._print_progress(i + 1, len(fixable_issues), "fixing")
                    
                if issue['model'] == 'DataStore' and issue['field'] == 'permission_type':
                    DataStore.objects.filter(id=issue['id']).update(permission_type=issue['fix_value'])
                    fixed_count += 1
                    if self.verbose:
                        self._print_success(f"Fixed DataStore {issue['id']} permission to '{issue['fix_value']}'")
                
                elif issue['model'] == 'Bucket' and issue['field'] == 'permission_type':
                    Bucket.objects.filter(id=issue['id']).update(permission_type=issue['fix_value'])
                    fixed_count += 1
                    if self.verbose:
                        self._print_success(f"Fixed Bucket {issue['id']} permission to 'private'")  
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        if fixed_count > 0:
            self._print_success(f"Fixed {fixed_count} permission issues")
        elif issues:
            self._print_warning("No permission issues could be fixed automatically")
            
    def verify_file_integrity(self, skip_fixes=False):
        """Verify file integrity and existence for Object model."""
        self._print_section_header("File Integrity Verification")
        issues = []
        start_time = time.time()

        total_objects = Object.objects.count()
        
        if total_objects == 0:
            self._print_success("No objects found to verify")
            return issues
        
        self._print_info(f"Found {total_objects} objects to verify...")
        
        # Process in batches of 500 objects to prevent memory issues
        paginator = Paginator(Object.objects.all(), 500)
        processed = 0
        
        # Process all pages
        for page_num in paginator.page_range:
            page_start_time = time.time()
            objects_in_page = paginator.page(page_num).object_list
            
            processed_pct = (processed / total_objects) * 100
            self._print_info(f"Processing batch {page_num}/{paginator.num_pages} - {processed}/{total_objects} objects ({processed_pct:.1f}%)...")
            
            batch_issues = 0
            
            # Process each object in the current batch
            for obj in objects_in_page:
                # Check if the file exists
                if not obj.file or not obj.file.name:
                    issue = {
                        'model': 'Object',
                        'id': obj.id,
                        'field': 'file',
                        'value': None,
                        'issue': 'Missing file reference',
                        'fixable': False,
                    }
                    issues.append(issue)
                    batch_issues += 1
                    if self.verbose:
                        self._print_warning(f"Object {obj.id} ({obj.name}): Missing file reference")
                    continue
                    
                # Check if the file exists on disk
                try:
                    if not os.path.exists(obj.file.path):
                        issue = {
                            'model': 'Object',
                            'id': obj.id,
                            'field': 'file',
                            'value': obj.file.path,
                            'issue': 'File does not exist on disk',
                            'fixable': False,
                        }
                        issues.append(issue)
                        batch_issues += 1
                        if self.verbose:
                            self._print_warning(f"Object {obj.id} ({obj.name}): File does not exist on disk - {obj.file.path}")
                        continue
                except Exception as e:
                    issue = {
                        'model': 'Object',
                        'id': obj.id,
                        'field': 'file',
                        'value': str(obj.file),
                        'issue': f'Error accessing file: {str(e)}',
                        'fixable': False,
                    }
                    issues.append(issue)
                    batch_issues += 1
                    if self.verbose:
                        self._print_warning(f"Object {obj.id} ({obj.name}): Error accessing file - {str(e)}")
                    continue
                
                #TODO: Additional checks for file integrity (size, checksum, etc.)
            
            processed += len(objects_in_page)
            batch_time = time.time() - page_start_time
            
            self._print_info(
                f"Completed batch {page_num}/{paginator.num_pages}: "
                f"{processed}/{total_objects} objects ({(processed/total_objects)*100:.1f}%) - "
                f"Found {batch_issues} issues in this batch - "
                f"Batch processing time: {batch_time:.2f}s - "
                f"Estimated time remaining: {(batch_time * (paginator.num_pages - page_num)):.1f}s"
            )
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        total_time = time.time() - start_time
        avg_time_per_object = total_time / total_objects if total_objects > 0 else 0

        # Fix issues if requested
        if self.fix and not skip_fixes:
            self.fix_file_issues(issues)
        
        if not issues:
            self._print_success(
                f"All files are valid and accounted for - "
                f"Processed {total_objects} objects in {total_time:.2f}s "
                f"({avg_time_per_object*1000:.2f}ms per object)"
            )
        else:
            self._print_error(
                f"Found {len(issues)} file integrity issues - "
                f"Processed {total_objects} objects in {total_time:.2f}s "
                f"({avg_time_per_object*1000:.2f}ms per object)"
            )
            
        return issues
    
    def fix_file_issues(self, issues):
        """Fix file integrity issues."""
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("┌" + "─" * (terminal_width - 2) + "┐"))
        self.stdout.write(self.style.SUCCESS("│" + " File Integrity Issue Fixes ".center(terminal_width - 2) + "│"))
        self.stdout.write(self.style.SUCCESS("└" + "─" * (terminal_width - 2) + "┘"))
        
        fixed_count = 0
        
        # Only proceed if there are fixable issues
        fixable_issues = [i for i in issues if i.get('fixable', False)]
        if not fixable_issues:
            self._print_info("No fixable file integrity issues found")
            return
        
        self._print_info(f"Attempting to fix {len(fixable_issues)} file integrity issues...")
        
        with transaction.atomic():
            for i, issue in enumerate(fixable_issues):
                if len(fixable_issues) > 10:
                    self._print_progress(i + 1, len(fixable_issues), "fixing")
                
                if not issue['fixable']:
                    continue
                
                if issue['model'] == 'Object':
                    if issue['field'] == 'size':
                        try:
                            obj = Object.objects.get(id=issue['id'])
                            actual_size = os.path.getsize(obj.file.path)
                            obj.size = actual_size
                            obj.save(update_fields=['size'])
                            fixed_count += 1
                            if self.verbose:
                                self._print_success(f"Fixed Object {issue['id']} size to {actual_size}")
                        except Exception as e:
                            if self.verbose:
                                self._print_warning(f"Couldn't fix Object {issue['id']} size: {str(e)}")
                    
                    elif issue['field'] == 'checksum':
                        try:
                            obj = Object.objects.get(id=issue['id'])
                            actual_checksum = obj.calculate_checksum()
                            if actual_checksum:
                                obj.checksum = actual_checksum
                                obj.save(update_fields=['checksum'])
                                fixed_count += 1
                                if self.verbose:
                                    self._print_success(f"Fixed Object {issue['id']} checksum")
                        except Exception as e:
                            if self.verbose:
                                self._print_warning(f"Couldn't fix Object {issue['id']} checksum: {str(e)}")
        
        terminal_width = os.get_terminal_size().columns
        self.stdout.write("\n" + self.style.SUCCESS("─" * terminal_width))
        
        if fixed_count > 0:
            self._print_success(f"Fixed {fixed_count} file integrity issues")
        elif fixable_issues:
            self._print_warning("No file integrity issues could be fixed automatically")