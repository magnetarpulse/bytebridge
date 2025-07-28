import logging
from typing import List, Optional
import threading
from django.conf import settings

logger = logging.getLogger(__name__)

class MetadataExtractionService:
    """
    Service responsible for extracting metadata from objects.
    
    This service implements the Single Responsibility Principle by focusing solely
    on metadata extraction management. It handles both queued (for SQLite) and
    threaded (for other databases) approaches to metadata extraction.
    """
    
    def __init__(self, object_repository=None):
        """
        Initialize the metadata extraction service.
        
        Args:
            object_repository: Repository for accessing Object models
                               (dependency injection for testability)
        """
        self._queue: List[str] = []
        self._processing: bool = False
        self._object_repository = object_repository
        
        # Only import Object when necessary, not during initialization
        # This prevents the circular import problem
        self._has_initialized_repository = False
    
    def _ensure_repository(self):
        """Initialize the repository on first use to avoid circular imports."""
        if not self._has_initialized_repository and self._object_repository is None:
            from django.apps import apps
            Object = apps.get_model('core', 'Object')
            self._object_repository = Object.objects
            self._has_initialized_repository = True
    
    def extract_metadata(self, object_id: str, use_queue: Optional[bool] = None) -> None:
        """
        Extract metadata for an object.
        
        Args:
            object_id: ID of the object to extract metadata for
            use_queue: Whether to use queued processing (defaults to settings)
        """
        print("I am extracting metadata")
        self._ensure_repository()
        
        if use_queue is None:
            use_queue = getattr(settings, 'USE_QUEUE_EXTRACTION', True)
        
        if use_queue:
            self.queue_extraction(object_id)
        else:
            self.thread_extraction(object_id)
        print("I am done extracting metadata")
    
    def queue_extraction(self, object_id: str) -> None:
        """
        Add an object to the extraction queue for sequential processing.
        
        Args:
            object_id: ID of the object to queue
        """
        self._ensure_repository()
        self._queue.append(object_id)
        logger.info(f"Queued metadata extraction for object {object_id}")
        
        if not self._processing:
            self._process_next()
    
    def _process_next(self) -> None:
        """Process the next item in the queue."""
        if not self._queue:
            self._processing = False
            return
            
        self._processing = True
        object_id = self._queue.pop(0)
        
        try:
            obj = self._object_repository.get(id=object_id)
            if obj.file:
                obj.extract_metadata()
                logger.info(f"Successfully extracted metadata for {obj.name}")
        except Exception as e:
            logger.exception(f"Error extracting metadata for object {object_id}: {e}")
        finally:
            # Process the next item in the queue
            self._process_next()
    
    def thread_extraction(self, object_id: str) -> None:
        """
        Extract metadata in a background thread.
        
        Args:
            object_id: ID of the object to process
        """
        self._ensure_repository()
        
        def extract_background():
            try:
                obj = self._object_repository.get(id=object_id)
                if obj.file:
                    obj.extract_metadata()
                    logger.info(f"Successfully extracted metadata for {obj.name}")
            except Exception as e:
                logger.exception(f"Error extracting metadata for object {object_id}: {e}")
        
        thread = threading.Thread(target=extract_background)
        thread.daemon = True
        thread.start()
        logger.info(f"Started background thread for metadata extraction for object {object_id}")

_metadata_service_instance = None

def get_metadata_service():
    """Get or create the singleton instance of the MetadataExtractionService."""
    global _metadata_service_instance
    if _metadata_service_instance is None:
        _metadata_service_instance = MetadataExtractionService()
    return _metadata_service_instance