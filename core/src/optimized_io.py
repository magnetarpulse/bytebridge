"""
High-performance utilities for ByteBridge file operations.

This module provides optimized implementations for file I/O and JSON operations
with SIMD acceleration and zero-copy operations when available.

Dependencies:
    - orjson: Fast JSON serialization with SIMD acceleration
    - pysendfile (optional): Zero-copy file operations via sendfile()
    - aiofile (optional): Linux AIO for async file operations

Example:
    >>> import asyncio
    >>> from bytebridge_utils import json_dumps, async_write_file
    >>> 
    >>> # Fast JSON serialization
    >>> data: dict[str, int] = {"key": 123}
    >>> json_bytes: bytes = json_dumps(data)
    >>> 
    >>> # Async file writing
    >>> asyncio.run(async_write_file("/tmp/test.bin", json_bytes))
"""

# Import all public APIs from the io_utils package
from .io_utils import (
    # JSON operations
    json_dumps,
    json_loads,
    JSONSerializable,
    
    # File operations
    async_write_file,
    zero_copy_merge,
    async_save_uploaded_file,
    
    # Types
    FilePathLike,
    FileData,
    UploadedFileProtocol,
    
    # Constants
    HAS_SENDFILE,
    HAS_AIOFILE
)

# Module-level constants for configuration
DEFAULT_BUFFER_SIZE: int = 8 * 1024 * 1024  # 8MB
DEFAULT_CHUNK_SIZE: int = 1024 * 1024       # 1MB

__all__ = [
    'json_dumps',
    'json_loads', 
    'async_write_file',
    'zero_copy_merge',
    'async_save_uploaded_file',
    'JSONSerializable',
    'FilePathLike',
    'FileData',
    'UploadedFileProtocol',
    'HAS_SENDFILE',
    'HAS_AIOFILE',
    'DEFAULT_BUFFER_SIZE',
    'DEFAULT_CHUNK_SIZE',
]