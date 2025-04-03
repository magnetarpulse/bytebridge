from django.conf import settings
from django.urls import path
from .views import *  # Import views from app

if settings.DEBUG:

    urlpatterns = [
        path('', BB_CONNECT, name='bb_connect'), # connect BB with NC
        path('api/user_datastore', CreateDatastoreAPI.as_view(), name='create_datastore_api'),  # Create datastore API
        path('api/change_ds_settings', Change_DS_Settings.as_view(), name='change_ds_settings'),  # Change settings API
        path('api/send_user_datastores', SendUserDatastoresAPI.as_view(), name='send_user_datastores'),  # Send datastores API
        path('api/change_bucket_settings', Change_Bucket_Settings.as_view(), name='change_bucket_settings'),  # Change settings API
        path('api/send_user_buckets', SendUserBucketAPI.as_view(), name='send_user_buckets'),  # Send buckets API
        path('api/send_all_datastores', SendAllDatastoresAPI.as_view(), name='send_all_datastores'),  # Send datastores API
        path('api/send_buckets', SendBuckets.as_view(), name='send_buckets'),  # Send buckets API
        path('api/create_buckets', CreateBuckets.as_view(), name='create_buckets'),  # Create buckets API
        path('api/create_objects', CreateObjects.as_view(), name='create_objects'),  # Upload objects API    

    ]
