"""
High-performance file operations with zero-copy support.

This module provides optimized implementations for file I/O operations,
including asynchronous file operations and zero-copy file transfers.
"""

import asyncio
import logging
import os
import shutil
from pathlib import Path
from typing import List, Union

# Type aliases for better readability
FilePathLike = Union[str, Path]
FileData = Union[bytes, bytearray, memoryview]

# Logger configuration
logger: logging.Logger = logging.getLogger(__name__)

# Optional dependency flags
HAS_SENDFILE: bool = False
HAS_AIOFILE: bool = False

# Import optional dependencies with fallbacks
try:
    from sendfile import sendfile
    HAS_SENDFILE = True
    logger.info("Pysendfile available. Zero-copy operations enabled")
except ImportError:
    logger.warning("Pysendfile not available. Falling back to shutil.copyfileobj")

try:
    import aiofile
    HAS_AIOFILE = True
    logger.info("Aiofile available. Linux AIO operations enabled")
except ImportError:
    logger.warning("Aiofile not available. Falling back to standard async file I/O")


async def async_write_file(file_path: FilePathLike, data: FileData) -> bool:
    """
    Write data to a file asynchronously using Linux AIO when available.
    
    This function uses aiofile for Linux AIO operations when available,
    falling back to asyncio.to_thread for standard file I/O.
    
    Args:
        file_path: Target file path (string or Path object)
        data: Binary data to write
        
    Returns:
        True if write was successful
        
    Raises:
        OSError: If file cannot be created or written
        PermissionError: If insufficient permissions for file operations
        
    Example:
        >>> import asyncio
        >>> data: bytes = b"Hello, World!"
        >>> success: bool = await async_write_file("/tmp/test.txt", data)
        >>> assert success is True
    """
    path_obj: Path = Path(file_path)
    
    # Create parent directories if they don't exist
    try:
        path_obj.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.error(f"Failed to create parent directories for {path_obj}: {e}")
        raise
    
    # Try aiofile first for Linux AIO
    if HAS_AIOFILE:
        try:
            async with aiofile.async_open(str(path_obj), 'wb') as file_handle:
                await file_handle.write(data)
                logger.debug(f"Successfully wrote {len(data)} bytes to {path_obj} using aiofile")
                return True
        except Exception as e:
            logger.warning(f"aiofile operation failed, falling back to standard I/O: {e}")
    
    # Fallback to asyncio.to_thread for standard file I/O
    def _write_file_sync(path: Path, content: FileData) -> bool:
        """Synchronous file write operation for thread execution."""
        try:
            with open(path, 'wb') as file_handle:
                file_handle.write(content)
            return True
        except OSError as e:
            logger.error(f"Failed to write file {path}: {e}")
            raise
    
    result: bool = await asyncio.to_thread(_write_file_sync, path_obj, data)
    logger.debug(f"Successfully wrote {len(data)} bytes to {path_obj} using standard I/O")
    return result


def zero_copy_merge(chunk_files: List[FilePathLike], output_path: FilePathLike) -> int:
    """
    Merge multiple files using zero-copy sendfile when available.
    
    This function uses the sendfile system call for zero-copy file merging
    when available, falling back to optimized buffered copy operations.
    
    Args:
        chunk_files: List of input file paths to merge
        output_path: Target output file path
        
    Returns:
        Total number of bytes written
        
    Raises:
        FileNotFoundError: If any input file doesn't exist
        OSError: If file operations fail
        PermissionError: If insufficient permissions
        
    Example:
        >>> chunk_paths: List[str] = ["/tmp/chunk1.bin", "/tmp/chunk2.bin"]
        >>> output_path: str = "/tmp/merged.bin"
        >>> total_bytes: int = zero_copy_merge(chunk_paths, output_path)
        >>> print(f"Merged {total_bytes} bytes")
    """
    if not chunk_files:
        logger.warning("No chunk files provided for merging")
        return 0
    
    output_path_obj: Path = Path(output_path)
    total_size: int = 0
    
    # Create parent directories if they don't exist
    try:
        output_path_obj.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        logger.error(f"Failed to create parent directories for {output_path_obj}: {e}")
        raise
    
    # Try zero-copy sendfile approach first
    if HAS_SENDFILE:
        try:
            with open(output_path_obj, 'wb') as out_file:
                out_fd: int = out_file.fileno()
                
                for chunk_path in chunk_files:
                    chunk_path_obj: Path = Path(chunk_path)
                    
                    if not chunk_path_obj.exists():
                        raise FileNotFoundError(f"Chunk file not found: {chunk_path_obj}")
                    
                    with open(chunk_path_obj, 'rb') as in_file:
                        in_fd: int = in_file.fileno()
                        file_size: int = os.fstat(in_fd).st_size
                        
                        # Use sendfile for zero-copy transfer
                        bytes_sent: int = sendfile(out_fd, in_fd, 0, file_size)
                        total_size += bytes_sent
                        
                        logger.debug(f"Sent {bytes_sent} bytes from {chunk_path_obj} using sendfile")
            
            logger.info(f"Successfully merged {len(chunk_files)} files ({total_size} bytes) using sendfile")
            return total_size
            
        except Exception as e:
            logger.warning(f"sendfile operation failed, falling back to buffered copy: {e}")
            total_size = 0  # Reset for fallback
    
    # Fallback to optimized buffered copy
    buffer_size: int = 8 * 1024 * 1024  # 8MB buffer for optimal throughput
    
    try:
        with open(output_path_obj, 'wb') as out_file:
            for chunk_path in chunk_files:
                chunk_path_obj: Path = Path(chunk_path)
                
                if not chunk_path_obj.exists():
                    raise FileNotFoundError(f"Chunk file not found: {chunk_path_obj}")
                
                with open(chunk_path_obj, 'rb') as in_file:
                    file_size: int = os.fstat(in_file.fileno()).st_size
                    bytes_copied: int = shutil.copyfileobj(in_file, out_file, buffer_size)
                    total_size += file_size
                    
                    logger.debug(f"Copied {file_size} bytes from {chunk_path_obj} using buffered I/O")
        
        logger.info(f"Successfully merged {len(chunk_files)} files ({total_size} bytes) using buffered copy")
        return total_size
        
    except OSError as e:
        logger.error(f"Failed to merge files: {e}")
        raise