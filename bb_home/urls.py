from django.urls import path
#from .views import FileUploadView
from django.conf import settings
from django.views.static import serve
from django.urls import re_path
from django.urls import path       # URL routing
from .views import *  # Import views from app
from django.conf.urls.static import static  # Static files serving
from django.contrib.staticfiles.urls import staticfiles_urlpatterns  # Static files serving


if settings.DEBUG:
    datastore_path = settings.DATASTORE['default']['PATH']

    urlpatterns = [
        #path('api/upload/', FileUploadView.as_view(), name='api-file-upload'),
        path('login/', login_page, name='login_page'),    # Login page
        path('register/', register_page, name='register'),  # Registration page
        path('upload/', upload_file, name='file-upload-page'),
        #re_path(r'^datastore/(?P<datastore_id>[\w-]+)/(?P<path>.*)$', serve, {'document_root': datastore_path}), 
    ]



    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

    # Serve static files using staticfiles_urlpatterns
    urlpatterns += staticfiles_urlpatterns()


