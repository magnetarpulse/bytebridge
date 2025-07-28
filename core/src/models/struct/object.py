from django.db import models
from .bucket import Bucket
import logging
import hashlib
from ..functions import create_object_file_path
from .datastore import DataStore

try:
    from django.db.models import JSONField
except ImportError:
    from django.contrib.postgres.fields import JSONField

logger = logging.getLogger(__name__)


class Object(models.Model):
    """
    An Object represents a file stored in a Bucket.
    
    Objects are the actual stored files within the ByteBridge system and contain
    metadata about the file such as size, content type, and checksum for integrity
    verification. Objects inherit access permissions from their parent Bucket.
    """
    class Meta:
        ordering = ['-created_at'] 
        
    name = models.CharField(max_length=255)
    bucket = models.ForeignKey(Bucket, on_delete=models.CASCADE, related_name='stored_objects')
    file = models.FileField(upload_to=create_object_file_path)
    content_type = models.CharField(max_length=100)
    size = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    last_modified = models.DateTimeField(auto_now=True)
    checksum = models.CharField(max_length=64, blank=True, null=True)
    type_metadata = JSONField(blank=True, null=True, default=dict)
    permission_type = models.CharField(
        max_length=10, 
        choices=DataStore.PERMISSION_CHOICES, 
        null=True, blank=True
    )
    
    def __str__(self):
        return self.name
    
    def get_effective_permission(self):
        """
        Return the effective permission for this object.
        
        If the object has its own permission setting, use that.
        Otherwise, inherit the permission from the parent Bucket.
        
        Returns:
            str: The effective permission type
        """
        return self.permission_type or self.bucket.get_effective_permission()
    
    def calculate_checksum(self):
        """
        Calculate and store the SHA-256 checksum of the file.
        
        This provides integrity verification by allowing the system
        to detect if a file has been modified or corrupted.
        """
        if not self.file:
            return None
            
        try:
            hasher = hashlib.sha256()
            with open(self.file.path, 'rb') as f:
                # Read file in chunks to handle large files efficiently
                for chunk in iter(lambda: f.read(65536), b''):
                    hasher.update(chunk)
            return hasher.hexdigest()
        except Exception as e:
            logger.error(f"Error calculating checksum for {self.name}: {e}")
            return None
    
    def extract_metadata(self):
        """
        Extract type-specific metadata based on the file's content type.
        
        This method analyzes the file content to extract relevant metadata
        based on the file type and stores it in the type_metadata field.
        It also calculates and updates the file checksum.
        """
        if not self.file:
            return
            
        # Calculate and update checksum if not already set
        if not self.checksum:
            self.checksum = self.calculate_checksum()
            
        metadata = {}
        
        # Extract metadata based on content type
        if self.content_type.startswith('image/'):
            metadata = self._extract_image_metadata()
        elif self.content_type.startswith('video/'):
            metadata = self._extract_video_metadata()
        elif self.content_type.startswith('audio/'):
            metadata = self._extract_audio_metadata()
        elif 'pdf' in self.content_type:
            metadata = self._extract_pdf_metadata()
        elif 'spreadsheet' in self.content_type or self.content_type == 'text/csv':
            metadata = self._extract_dataset_metadata()
        elif 'document' in self.content_type or 'text/' in self.content_type:
            metadata = self._extract_document_metadata()
            
        # Store the extracted metadata and checksum
        self.type_metadata = metadata
        self.save(update_fields=['type_metadata', 'checksum'])
        
        return metadata

    
    def _extract_image_metadata(self):
        """Extract metadata for image files."""
        try:
            from PIL import Image
            img = Image.open(self.file.path)
            return {
                'width': img.width,
                'height': img.height,
                'color_space': img.mode,
                'has_alpha': 'A' in img.mode
            }
        except Exception as e:
            logger.error(f"Error extracting image metadata: {e}")
            return {}
    
    def _extract_video_metadata(self):
        """Extract metadata for video files."""
        try:
            # Using ffmpeg-python would be ideal here
            # For simplicity, we'll return placeholder data
            return {
                'duration': 0,  # Would be extracted from actual file
                'resolution': '0x0',
                'frame_rate': 0,
                'codec': 'unknown'
            }
        except Exception as e:
            logger.error(f"Error extracting video metadata: {e}")
            return {}
    
    def _extract_audio_metadata(self):
        """Extract metadata for audio files."""
        try:
            # Would use a library like mutagen or pydub
            return {
                'duration': 0,
                'bit_rate': 0,
                'sample_rate': 0,
                'channels': 0
            }
        except Exception as e:
            logger.error(f"Error extracting audio metadata: {e}")
            return {}
    
    def _extract_pdf_metadata(self):
        """Extract metadata for PDF files."""
        try:
            # Would use a library like PyPDF2 or pdfminer
            return {
                'page_count': 0,
                'author': '',
                'title': '',
                'creation_date': ''
            }
        except Exception as e:
            logger.error(f"Error extracting PDF metadata: {e}")
            return {}
    
    def _extract_dataset_metadata(self):
        """
        Extract metadata for dataset files using Polars for optimized performance.
        """
        try:
            import polars as pl
            
            if self.file.path.endswith('.csv'):
                # Use scan_csv which is lazy and doesn't load the whole file
                df = pl.scan_csv(self.file.path)
                schema = df.collect_schema()
                
                # Get only the metadata we need without loading the full dataset
                column_names = list(schema.keys())
                column_count = len(column_names)
                
                # Count rows efficiently - only materialize the count
                row_count = df.select(pl.len()).collect().item()
                
                return {
                    'row_count': row_count,
                    'column_count': column_count,
                    'format': 'CSV',
                    'column_names': column_names,
                    'dtypes': {name: str(dtype) for name, dtype in schema.items()}
                }
                
            elif self.file.path.endswith(('.xls', '.xlsx')):
                df = pl.read_excel(self.file.path, sheet_id=0)
                
                return {
                    'row_count': df.height,
                    'column_count': df.width,
                    'format': self.file.path.split('.')[-1].upper(),
                    'column_names': df.columns,
                    'sheet_count': 1  # Would need to scan all sheets to get count
                }
            
        except ImportError:
            # Fall back to pandas if Polars isn't available
            logger.warning("Polars not installed, falling back to pandas for dataset metadata extraction")
        except Exception as e:
            # Fall back to pandas if there's any error with Polars
            logger.warning(f"Error with Polars, falling back to pandas: {e}")
        
        try:
            import pandas as pd
            
            if self.file.path.endswith('.csv'):
                # Use pandas with optimized settings
                df = pd.read_csv(self.file.path, memory_map=True)
            elif self.file.path.endswith(('.xls', '.xlsx')):
                df = pd.read_excel(self.file.path, engine='openpyxl')
            else:
                return {}
                
            return {
                'row_count': len(df),
                'column_count': len(df.columns),
                'format': self.file.path.split('.')[-1].upper(),
                'column_names': df.columns.tolist(),
                'dtypes': {col: str(dtype) for col, dtype in df.dtypes.items()}
            }
        except Exception as e:
            logger.error(f"Error extracting dataset metadata with pandas: {e}")
            return {}
    
    def _extract_document_metadata(self):
        """Extract metadata for document files (DOCX, TXT, etc)."""
        try:
            # Would use libraries specific to the document type
            return {
                'page_count': 0,
                'author': '',
                'title': '',
                'word_count': 0
            }
        except Exception as e:
            logger.error(f"Error extracting document metadata: {e}")
            return {}