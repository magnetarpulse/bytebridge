"""
JSON utility functions with SIMD acceleration.

This module provides high-performance JSON serialization and deserialization
using the orjson library, which utilizes SIMD instructions for better performance.
"""

import logging
from typing import Union

import orjson

# Type aliases for better readability
JSONSerializable = Union[dict, list, str, int, float, bool, None]

# Logger configuration
logger: logging.Logger = logging.getLogger(__name__)


def json_dumps(obj: JSONSerializable) -> bytes:
    """
    Serialize Python object to JSON bytes using SIMD-accelerated orjson.
    
    This function is 5-10x faster than the standard library json module
    due to SIMD acceleration and optimized C implementation.
    
    Args:
        obj: Python object to serialize (dict, list, str, int, float, bool, None)
        
    Returns:
        JSON-encoded bytes
        
    Raises:
        TypeError: If object contains non-serializable types
        
    Example:
        >>> data: dict[str, Any] = {"name": "test", "count": 42}
        >>> json_bytes: bytes = json_dumps(data)
        >>> print(json_bytes)
        b'{"name":"test","count":42}'
    """
    try:
        return orjson.dumps(
            obj, 
            option=orjson.OPT_NON_STR_KEYS | orjson.OPT_SERIALIZE_NUMPY
        )
    except TypeError as e:
        logger.error(f"Failed to serialize object to JSON: {e}")
        raise


def json_loads(data: Union[bytes, bytearray, memoryview]) -> JSONSerializable:
    """
    Deserialize JSON bytes to Python objects using SIMD-accelerated orjson.
    
    This function is 5-10x faster than the standard library json module
    due to SIMD acceleration and optimized C implementation.
    
    Args:
        data: JSON-encoded bytes, bytearray, or memoryview
        
    Returns:
        Deserialized Python object
        
    Raises:
        orjson.JSONDecodeError: If data is not valid JSON
        
    Example:
        >>> json_bytes: bytes = b'{"name":"test","count":42}'
        >>> data: dict[str, Any] = json_loads(json_bytes)
        >>> print(data)
        {'name': 'test', 'count': 42}
    """
    try:
        return orjson.loads(data)
    except orjson.JSONDecodeError as e:
        logger.error(f"Failed to deserialize JSON data: {e}")
        raise
