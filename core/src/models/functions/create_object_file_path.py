import uuid
import os
import logging

logger = logging.getLogger(__name__)


def create_object_file_path(instance, filename):
    """
    Generate a unique path for uploaded files.
    
    This function ensures that each uploaded file is stored with a unique
    filename within a directory structure organized by bucket IDs.
    
    Args:
        instance: The Object instance the file is attached to
        filename: The original filename
        
    Returns:
        str: A unique file path for storing the file
    """
    ext = filename.split('.')[-1]
    unique_filename = f"{uuid.uuid4()}.{ext}"
    return os.path.join('objects', str(instance.bucket.id), unique_filename)