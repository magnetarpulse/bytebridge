"""
ASGI config for bytebridge project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/asgi/
"""

import os
import logging
from contextlib import asynccontextmanager

from django.core.asgi import get_asgi_application

logger = logging.getLogger("bytebridge.asgi")

# Set the Django settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'bytebridge.settings')

# Lifespan handler to manage startup and shutdown events
@asynccontextmanager
async def lifespan(scope, receive, send):
    """
    Lifespan protocol handler that logs startup and shutdown events.
    This resolves the ASGI Framework Lifespan warning.
    """
    # Startup phase
    if scope["type"] == "lifespan":
        message = await receive()
        if message["type"] == "lifespan.startup":
            logger.info("ByteBridge ASGI application starting up")
            await send({"type": "lifespan.startup.complete"})
            
    # Yield control to the application
    yield
    
    # Shutdown phase
    if scope["type"] == "lifespan":
        message = await receive()
        if message["type"] == "lifespan.shutdown":
            logger.info("ByteBridge ASGI application shutting down")
            # Perform any cleanup here if needed
            await send({"type": "lifespan.shutdown.complete"})

# Get the ASGI application with lifespan support
django_app = get_asgi_application()

# Wrap the Django application with the lifespan handler
async def application(scope, receive, send):
    if scope["type"] == "lifespan":
        async with lifespan(scope, receive, send):
            # The lifespan context manager handles everything
            pass  
    else:
        await django_app(scope, receive, send)