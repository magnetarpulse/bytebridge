from django.conf import settings
from django.conf.urls.static import static
from django.urls import path
from .views import *  # Import views from app

if settings.DEBUG:

    urlpatterns = [
        path('', home_view, name='home'),  # Redirect root to home
        path('api/user_datastore', CreateDatastoreAPI.as_view(), name='create_datastore_api'),  # Create datastore API
        
        
        path('api/change_ds_settings', Change_DS_Settings.as_view(), name='change_ds_settings'),  # Change settings API
        path('api/change_bucket_settings', Change_Bucket_Settings.as_view(), name='change_bucket_settings'),  # Change settings API

        #path('api/send_user_datastores', SendUserDatastoresAPI.as_view(), name='send_user_datastores'),  # Send datastores API
        #path('api/send_all_datastores', SendAllDatastoresAPI.as_view(), name='send_all_datastores'),  # Send datastores API

        path('api/send_datastores', SendDatastoresAPI.as_view(), name='get_datastore_api'),  # Get datastore API

        path('api/send_user_buckets', SendUserBucketAPI.as_view(), name='send_user_buckets'),  # Send buckets API
        path('api/send_all_buckets', SendAllBuckets.as_view(), name='send_buckets'),  # Send buckets API
        
        path('api/create_buckets', CreateBuckets.as_view(), name='create_buckets'),  # Create buckets API
        
        path('api/create_objects', CreateObjects.as_view(), name='create_objects'),  # Upload objects API   

        path('api/list_datasets', List_Datasets.as_view(), name='list_datasets'),  # List datasets API 
        path('api/view_file', ViewFile.as_view(), name='view_file'),  # View file API

        path('api/bb_delete_file', BB_Delete_File.as_view(), name='bb_delete_file'),  # Delete file API

    ] + static(settings.DATASTORE_URL, document_root=settings.DATASTORE_ROOT)
