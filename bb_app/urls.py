from django.conf import settings
from django.urls import path
from .views import *  # Import views from app
from . import views

if settings.DEBUG:

    urlpatterns = [
        path('', BB_CONNECT, name='bb_connect'), # connect BB with NC
        path('api/user_datastore', CreateDatastoreAPI.as_view(), name='create_datastore_api'),  # Create datastore API
        path('api/change_ds_settings', Change_DS_Settings.as_view(), name='change_ds_settings'),  # Chnage settings API
        path('api/send_user_datastores', SendUserDatastoresAPI.as_view(), name='send_datastores'),  # Send datastores API
        
        path('list_files/', list_files, name='list_files'),
        path('files/<str:filename>/', serve_file, name='serve_file'),
        path("fetch_file/", views.fetch_file, name="fetch_file"),

    ]