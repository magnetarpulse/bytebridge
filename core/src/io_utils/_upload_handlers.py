"""
High-performance upload handling utilities.

This module provides specialized functions for handling file uploads
with optimized I/O operations and support for various file-like objects.
"""

import asyncio
import logging
from pathlib import Path
from typing import Any, BinaryIO, Protocol, Union

# Logger configuration
logger: logging.Logger = logging.getLogger(__name__)

# Import optional dependencies
try:
    import aiofile
    HAS_AIOFILE = True
except ImportError:
    HAS_AIOFILE = False


class UploadedFileProtocol(Protocol):
    """Protocol for uploaded file objects (e.g., Django's InMemoryUploadedFile)."""
    
    def chunks(self, chunk_size: int = ...) -> Any:
        """Return an iterator of chunks from the file."""
        ...
    
    def read(self) -> bytes:
        """Read the entire file content."""
        ...


async def async_save_uploaded_file(
    file_obj: Union[UploadedFileProtocol, BinaryIO, Union[bytes, bytearray, memoryview]], 
    path: Union[str, Path]
) -> int:
    """
    Save an uploaded file asynchronously using optimized methods.
    
    This function handles different types of file objects:
    - Django's InMemoryUploadedFile (with chunks() method)
    - File-like objects with read() method
    - Raw bytes/bytearray objects
    
    Args:
        file_obj: File object to save (Django upload, file-like, or bytes)
        path: Target path to save the file
        
    Returns:
        Number of bytes written
        
    Raises:
        OSError: If file cannot be created or written
        PermissionError: If insufficient permissions
        ValueError: If file_obj type is not supported
        
    Example:
        >>> # Django uploaded file
        >>> bytes_written: int = await async_save_uploaded_file(uploaded_file, "/tmp/upload.bin")
        >>> print(f"Saved {bytes_written} bytes")
    """
    # Always use the provided path exactly as given, don't use file_obj.name
    path_obj: Path = Path(path)
    
    # Create parent directories if they don't exist
    try:
        path_obj.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.error(f"Failed to create parent directories for {path_obj}: {e}")
        raise
    
    # Handle Django's InMemoryUploadedFile or similar with chunks() method
    if hasattr(file_obj, 'chunks') and callable(getattr(file_obj, 'chunks')):
        def _save_chunked_upload() -> int:
            """Save uploaded file using chunk-based reading."""
            total_bytes: int = 0
            chunk_size: int = 1024 * 1024  # 1MB chunks for optimal memory usage
            
            try:
                # Always use the provided path_obj, not anything from file_obj.name
                with open(path_obj, 'wb') as file_handle:
                    for chunk in file_obj.chunks(chunk_size=chunk_size):
                        chunk_bytes: bytes = bytes(chunk)
                        file_handle.write(chunk_bytes)
                        total_bytes += len(chunk_bytes)
                        
                logger.debug(f"Saved chunked upload: {total_bytes} bytes to {path_obj}")
                return total_bytes
                
            except OSError as e:
                logger.error(f"Failed to save chunked upload to {path_obj}: {e}")
                raise
        
        return await asyncio.to_thread(_save_chunked_upload)
    
    # Handle file-like objects with read() method
    elif hasattr(file_obj, 'read') and callable(getattr(file_obj, 'read')):
        def _save_file_like() -> int:
            """Save file-like object by reading all content."""
            try:
                with open(path_obj, 'wb') as file_handle:
                    data: bytes = file_obj.read()
                    file_handle.write(data)
                    
                bytes_written: int = len(data)
                logger.debug(f"Saved file-like object: {bytes_written} bytes to {path_obj}")
                return bytes_written
                
            except OSError as e:
                logger.error(f"Failed to save file-like object to {path_obj}: {e}")
                raise
        
        return await asyncio.to_thread(_save_file_like)
    
    # Handle raw bytes/bytearray objects
    elif isinstance(file_obj, (bytes, bytearray, memoryview)):
        data_bytes: bytes = bytes(file_obj)
        
        # Use aiofile if available for async I/O
        if HAS_AIOFILE:
            try:
                async with aiofile.async_open(str(path_obj), 'wb') as file_handle:
                    await file_handle.write(data_bytes)
                    bytes_written: int = len(data_bytes)
                    logger.debug(f"Saved bytes object using aiofile: {bytes_written} bytes to {path_obj}")
                    return bytes_written
            except Exception as e:
                logger.warning(f"aiofile operation failed, falling back to standard I/O: {e}")
        
        # Fallback to standard async I/O
        def _write_bytes() -> int:
            """Write bytes to file synchronously."""
            try:
                with open(path_obj, 'wb') as file_handle:
                    file_handle.write(data_bytes)
                return len(data_bytes)
            except OSError as e:
                logger.error(f"Failed to write bytes to {path_obj}: {e}")
                raise
        
        bytes_written = await asyncio.to_thread(_write_bytes)
        logger.debug(f"Saved bytes object using standard I/O: {bytes_written} bytes to {path_obj}")
        return bytes_written
    
    else:
        error_msg: str = f"Unsupported file object type: {type(file_obj)}"
        logger.error(error_msg)
        raise ValueError(error_msg)