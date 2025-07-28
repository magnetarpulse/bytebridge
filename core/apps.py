from django.apps import AppConfig

class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        import core.signals  
        from .src.models import (
            create_object_file_path,

            MetadataExtractionService,
            get_metadata_service,

            Bucket,
            ByteBridgeInstance,
            DataStore,
            Object
        )

        from .src.authentication import (
            EncryptionKeyPair,
            SigningKeyPair
        )