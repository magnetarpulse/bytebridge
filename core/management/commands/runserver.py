from django.core.management.commands.runserver import Command as RunserverCommand
import os
import importlib

class Command(RunserverCommand):
    """
    Custom server command that extends runserver and updates API_PORT setting.
    Similar to runserver but also configures the API settings with the actual port.
    """
    
    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.description = "Runs the server with proper API port configuration"
    
    def handle(self, *args, **options):
        # Skip config output during auto-reload
        is_reloader = os.environ.get('RUN_MAIN') == 'true'
        
        # Get the port from options (defaults to 8000)
        addrport = options.get('addrport', '')
        if addrport:
            # Extract port from addrport (which may be in the format 'host:port')
            parts = addrport.split(':')
            if len(parts) > 1 and parts[-1].isdigit():
                port = parts[-1]
                if not is_reloader:
                    self.stdout.write(self.style.SUCCESS(f"Using port: {port}"))
            else:
                port = '8000'
                if not is_reloader:
                    self.stdout.write(self.style.WARNING(f"Could not extract port from '{addrport}', using default: {port}"))
        else:
            port = '8000'
            if not is_reloader:
                self.stdout.write(self.style.SUCCESS(f"Using default port: {port}"))
        
        # Set environment variable for API_PORT - this is needed in both initial run and reloader
        os.environ['API_PORT'] = port
        
        # Only update settings during initial run, not during auto-reload
        if not is_reloader:
            try:
                settings_module = importlib.import_module('bytebridge.settings')
                if hasattr(settings_module, 'update_api_port'):
                    new_url = settings_module.update_api_port(port)
                    self.stdout.write(self.style.SUCCESS(
                        f"API endpoint configured as: {new_url}"
                    ))
                else:
                    self.stdout.write(self.style.WARNING(
                        "Could not find update_api_port in settings module"
                    ))
            except ImportError:
                self.stdout.write(self.style.ERROR(
                    "Could not import settings module"
                ))
        
        # Call the original runserver command
        super().handle(*args, **options)