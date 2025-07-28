from django.core.management.base import BaseCommand
from django.conf import settings
import shutil

class Command(BaseCommand):
    help = 'Check NeuroController configuration'

    def handle(self, *args, **options):
        terminal_width = shutil.get_terminal_size().columns
        divider = "═" * terminal_width
        separator = "─" * terminal_width

        self.stdout.write(self.style.NOTICE(divider))
        title = "NeuroController Configuration Check"
        padding = (terminal_width - len(title)) // 2
        self.stdout.write(self.style.NOTICE(" " * padding + title))
        self.stdout.write(self.style.NOTICE(divider))
        
        self.stdout.write(f"• NEUROCONTROLLER_URL:   {self._format_value(settings.NEUROCONTROLLER_URL)}")
        
        token_id = settings.NEUROCONTROLLER_TOKEN_ID
        token_valid = bool(token_id and len(token_id) == 64)
        
        if token_id:
            if len(token_id) > 10:
                masked_token = f"{token_id[:4]}...{token_id[-4:]}"
            else:
                masked_token = token_id
                
            if token_valid:
                self.stdout.write(f"• NEUROCONTROLLER_TOKEN: {self.style.SUCCESS(masked_token)}")
            else:
                self.stdout.write(f"• NEUROCONTROLLER_TOKEN: {self.style.ERROR(masked_token)} (invalid length)")
        else:
            self.stdout.write(f"• NEUROCONTROLLER_TOKEN: {self.style.ERROR('Not set!')}")
        
        self.stdout.write(f"• API_HOST:              {self._format_value(settings.API_HOST)}")
        self.stdout.write(f"• API_PORT:              {self._format_value(settings.API_PORT)}")
        self.stdout.write(f"• API_PROTOCOL:          {self._format_value(settings.API_PROTOCOL)}")
        self.stdout.write(f"• API_BASE_URL:          {self._format_value(settings.API_BASE_URL)}")
        
        self.stdout.write(self.style.NOTICE(separator))
        if all([settings.NEUROCONTROLLER_URL, token_valid, 
                settings.API_HOST, settings.API_PORT, settings.API_PROTOCOL]):
            self.stdout.write(self.style.SUCCESS("✅ All required NeuroController settings are configured."))
        else:
            self.stdout.write(self.style.ERROR("❌ Some NeuroController settings are missing or invalid!"))
        self.stdout.write(self.style.NOTICE(divider))

    def _format_value(self, value):
        if not value:
            return self.style.ERROR("Not set!")
        return self.style.SUCCESS(value)