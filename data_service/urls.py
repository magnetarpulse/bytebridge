from django.conf import settings
from django.conf.urls.static import static
from django.urls import path, re_path
from .views import *  # Import views from app

if settings.DEBUG:

    urlpatterns = [
        path('', home_view, name='home'),  # Redirect root to home

        # Check if user has a datastore or create one
        path('api/check_user_datastore', CheckDatastoreAPI.as_view(), name='check_datastore_api'),  # Check datastore API
        
        path('api/change_ds_settings', Change_DS_Settings.as_view(), name='change_ds_settings'),  # Change settings API
        #path('api/change_bucket_settings', Change_Bucket_Settings.as_view(), name='change_bucket_settings'),  # Change settings API

        # Get all datastores: api/(all_datastores)
        path('api/datastores', ListDatastoresAPI.as_view(), name='list_datastore'), 


        # Get all buckets from a datastore: api/$datastore_id/buckets
        re_path(r'^api(?:/(?P<selected_ds>[^/]+))?/buckets$', ListBucketsAPI.as_view(), name='list_buckets'), 
        
        # Create buckets in a datastore: api/$datastore_id/create_buckets
        re_path(r'^api/(?P<selected_ds>[^/]+)/create_buckets$', CreateBuckets.as_view(), name='create_buckets'),  
        
        # Create Objects in a bucket in a datastore: api/$datastore_id/$bucket_id/objects
        re_path(r'^api/(?P<selected_ds>[^/]+)/(?P<selected_bucket>[^/]+)/create_objects$', CreateObjects.as_view(), name='create_objects'),  
        
        
        # Delete buckets from a datastore: api/$datastore_id/$bucket_id/delete_buckets  
        re_path(r'^api/(?P<selected_ds>[^/]+)/(?P<selected_bucket>[^/]+)/delete_buckets$', DeleteBuckets.as_view(), name='delete_buckets'),

        # Get objects from a bucket from a datastore: api/$datastore_id/$bucket_id/objects
        re_path(r'^api/(?P<selected_ds>[^/]+)/(?P<selected_bucket>[^/]+)/objects$', ListObjects.as_view(), name='list_objects'),  
        
        
        #path('api/<str:datastore_id>/',GetInfoDatastoreAPI.as_view(), name='get_datastore_info_api'),  # Get datastore info API
        
        # Delete an object based on file_id: api/$file_id/delete_object
        re_path(r'^api/(?P<file_id>[^/]+)/delete_object$', DeleteObject.as_view(), name='delete_object'),  # Delete Object API
        
        # View an object based on file_id: api/$file_id/view_object
        re_path(r'^api/(?P<file_id>[^/]+)/view_object$', ViewObject.as_view(), name='view_object'),  # View object API

    
    ] + static(settings.DATASTORE_URL, document_root=settings.DATASTORE_ROOT)
