import logging
from django.core.management.base import BaseCommand, CommandError
from core.src.authentication.services import KeyManagementService

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    """
    Management command to generate or rotate the server's cryptographic keypair.
    
    This command safely manages the server's Ed25519 keypair used for signing
    authentication challenges and other server-side cryptographic operations.
    """
    help = 'Generate or rotate the server\'s cryptographic keypair'

    def add_arguments(self, parser):
        """Add command-line arguments"""
        parser.add_argument(
            '--rotate',
            action='store_true',
            help='Force rotation of the keypair even if one already exists',
        )
        parser.add_argument(
            '--get',
            '-g',
            action='store_true',
            help='Display information about the current active keypair',
        )
        parser.add_argument(
            '--yes-i-am-sure',
            action='store_true',
            dest='confirmed',
            help='Skip confirmation prompt for keypair rotation',
        )

    def display_keypair_info(self, keypair):
        """Helper method to display information about a keypair"""
        self.stdout.write(
            self.style.SUCCESS(f"Server keypair ID: {keypair.id}")
        )
        self.stdout.write("\nServer public key (base64):")
        self.stdout.write(keypair.public_key)
        self.stdout.write("\nStore this public key securely for reference.")

    def handle(self, *args, **options):
        """Execute the command"""
        try:
            # Check if a keypair already exists
            existing_keypair = None
            try:
                existing_keypair = KeyManagementService.get_or_create_ed25519_signing_keypair()
            except Exception as e:
                # If get_or_create fails, we definitely need a new keypair
                self.stdout.write(self.style.WARNING(f"No valid keypair found: {str(e)}"))
                existing_keypair = None

            # If --get is provided, just display the current keypair and exit
            if options['get']:
                if existing_keypair:
                    self.stdout.write(self.style.NOTICE("Current active keypair:"))
                    self.display_keypair_info(existing_keypair)
                else:
                    self.stdout.write(self.style.WARNING("No active keypair found."))
                return

            # Determine if we're generating or rotating
            if existing_keypair and not options['rotate']:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Server keypair already exists (ID: {existing_keypair.id}). "
                        f"Use --rotate to force rotation."
                    )
                )
                return

            # If rotating, confirm unless --yes-i-am-sure is provided
            if existing_keypair and not options['confirmed']:
                self.stdout.write(
                    self.style.WARNING(
                        "WARNING: Rotating the server keypair will invalidate all existing signatures.\n"
                        "Client verification operations will fail until they obtain the new public key.\n"
                        "Are you sure you want to proceed? [y/N]: "
                    )
                )
                confirmation = input().lower()
                if confirmation != 'y' and confirmation != 'yes':
                    self.stdout.write(self.style.NOTICE("Keypair rotation cancelled."))
                    return

            # Proceed with keypair generation/rotation
            if options['rotate']:
                self.stdout.write("Rotating server keypair...")
                keypair = KeyManagementService.rotate_ed25519_signing_keypair()
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Server keypair successfully rotated! New keypair ID: {keypair.id}"
                    )
                )
            else:
                self.stdout.write("Generating new server keypair...")
                keypair = KeyManagementService.generate_ed25519_signing_keypair()
                self.stdout.write(
                    self.style.SUCCESS(
                        f"Server keypair successfully generated! Keypair ID: {keypair.id}"
                    )
                )

            # Display the keypair information
            self.display_keypair_info(keypair)

        except Exception as e:
            logger.error(f"Error in generate_ed25519_signing_keypair command: {str(e)}", exc_info=True)
            raise CommandError(f"Failed to generate server keypair: {str(e)}")