"""
High-performance utilities for ByteBridge file operations.

This package provides optimized implementations for file I/O and JSON operations
with SIMD acceleration and zero-copy operations when available.

Modules:
    - json_utils: Fast JSON serialization with SIMD acceleration
    - file_ops: Core file operations (async read/write, zero-copy)
    - upload_handlers: Specialized handlers for file uploads

Dependencies:
    - orjson: Fast JSON serialization with SIMD acceleration
    - pysendfile (optional): Zero-copy file operations via sendfile()
    - aiofile (optional): Linux AIO for async file operations

Example:
    >>> import asyncio
    >>> from bytebridge.core.src.io_utils import json_dumps, async_write_file
    >>> 
    >>> # Fast JSON serialization
    >>> data: dict[str, int] = {"key": 123}
    >>> json_bytes: bytes = json_dumps(data)
    >>> 
    >>> # Async file writing
    >>> asyncio.run(async_write_file("/tmp/test.bin", json_bytes))
"""

import logging

# Import public API from modules
from ._json_utils import (
    json_dumps,
    json_loads,
    JSONSerializable
)

from ._file_ops import (
    async_write_file,
    zero_copy_merge,
    FilePathLike,
    FileData,
    HAS_SENDFILE,
    HAS_AIOFILE
)

from ._upload_handlers import (
    async_save_uploaded_file,
    UploadedFileProtocol
)

# Module-level constants for configuration
DEFAULT_BUFFER_SIZE: int = 8 * 1024 * 1024  # 8MB
DEFAULT_CHUNK_SIZE: int = 1024 * 1024       # 1MB

# Configure logger
logger: logging.Logger = logging.getLogger(__name__)

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
]