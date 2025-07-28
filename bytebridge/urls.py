"""
URL configuration for bytebridge project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.http import HttpResponseRedirect
from django.views.generic import TemplateView
from django.views.static import serve
import os
from rest_framework import permissions
from drf_yasg.views import get_schema_view
from drf_yasg import openapi
import mimetypes

# Ensure JavaScript files are served correctly
mimetypes.add_type("application/javascript", ".js")

# Custom view to serve worker scripts with proper MIME type
def serve_worker_script(request, path=None, document_root=None):
    """Serve worker scripts with the correct MIME type."""
    if document_root is None:
        document_root = os.path.join(settings.BASE_DIR, 'static')
    
    response = serve(request, path, document_root=document_root)
    response['Content-Type'] = 'application/javascript'
    return response

# Redirect from /assets/ to /static/frontend/assets/
def redirect_assets(request, path):
    return HttpResponseRedirect(f'/static/frontend/assets/{path}')

schema_view = get_schema_view(
   openapi.Info(
      title="ByteBridge API",
      default_version='v1',
      description="API for ByteBridge storage system - Work in Progress",
      terms_of_service="",  
      contact=openapi.Contact(email=""),  
      license=openapi.License(name="GNU General Public License"),
   ),
   public=True,
   permission_classes=[permissions.AllowAny],
)

urlpatterns = [
    # Admin site
    path('admin/', admin.site.urls),
    
    # REST framework browseable API
    path('api-auth/', include('rest_framework.urls', namespace='rest_framework')),
    
    # Authentication
    path('accounts/', include('django.contrib.auth.urls')),
    
    # API and documentation
    path('api/v1/', include(('api.urls', 'api_v1'), namespace='api_v1')),
    path('swagger/', schema_view.with_ui('swagger', cache_timeout=0), name='schema-swagger-ui'),
    path('redoc/', schema_view.with_ui('redoc', cache_timeout=0), name='schema-redoc'),
    
    # Application URLs
    path('integrations/', include('integrations.urls', namespace='integrations')),

    # Users
    path('users/', include('users.urls')),
    
    # Redirect from /assets/ to /static/frontend/assets/ 
    re_path(r'^assets/(?P<path>.*)$', redirect_assets),
    
    # Serve the React app template for all non-matched routes
    re_path(r'^(?!admin/)(?!api/)(?!accounts/)(?!swagger/)(?!redoc/)(?!integrations/)(?!users/)(?!media/)(?!static/)(?!assets/).*$', 
            TemplateView.as_view(template_name='index.html')),
]

# Add a dedicated debug view to check static file serving
def debug_view(request):
    from django.http import HttpResponse
    import json
    
    # Check if worker files exist on disk
    worker_paths = [
        'frontend/assets/encryption.streaming.worker-7CTcz6CP.js',
        'frontend/assets/encryption.worker-BpUaASJc.js'
    ]
    
    info = {
        'STATIC_ROOT': settings.STATIC_ROOT,
        'STATIC_URL': settings.STATIC_URL,
        'BASE_DIR': str(settings.BASE_DIR),
        'workers': {}
    }
    
    for path in worker_paths:
        full_path = os.path.join(settings.BASE_DIR, 'static', path)
        info['workers'][path] = {
            'exists': os.path.exists(full_path),
            'size': os.path.getsize(full_path) if os.path.exists(full_path) else 0,
            'full_path': full_path
        }
    
    return HttpResponse(f"<pre>{json.dumps(info, indent=2)}</pre>")

def serve_worker_directly(request, filename):
    """Serve worker files with the correct content type."""
    import os
    from django.http import HttpResponse, FileResponse
    
    worker_path = os.path.join(settings.BASE_DIR, 'static', 'frontend', 'assets', filename)
    
    if os.path.exists(worker_path):
        with open(worker_path, 'rb') as f:
            response = HttpResponse(f.read(), content_type='application/javascript')
        return response
    else:
        return HttpResponse(f"Worker file not found: {worker_path}", status=404)

# Add the debug view to urlpatterns
urlpatterns.append(path('debug/', debug_view))

# Simple approach to serve static files
urlpatterns += static(settings.STATIC_URL, document_root=os.path.join(settings.BASE_DIR, 'static'))
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
urlpatterns += [
    path('workers/encryption.worker-BpUaASJc.js', serve_worker_directly, {'filename': 'encryption.worker-BpUaASJc.js'}),
    path('workers/encryption.streaming.worker-7CTcz6CP.js', serve_worker_directly, {'filename': 'encryption.streaming.worker-7CTcz6CP.js'}),
]