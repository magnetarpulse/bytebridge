from django.urls import path
from . import views

app_name = 'integrations'

urlpatterns = [
    # Web UI routes
    path('', views.dashboard, name='dashboard'),
    path('register/instance/', views.register_instance, name='register_instance'),
    path('register/datastore/', views.register_datastore, name='register_datastore'),
    path('create/datastore/', views.create_datastore, name='create_datastore'),
    path('datastores/<int:datastore_id>/', views.datastore_detail, name='datastore_detail'),
    
    # API endpoints
    path('api/register/instance/', views.api_register_instance, name='api_register_instance'),
    path('api/register/datastore/', views.api_register_datastore, name='api_register_datastore'),
    path('api/create/datastore/', views.api_create_datastore, name='api_create_datastore'),
    path('api/sync/datastore', views.api_sync_datastore, name='api_sync_datastore'),
]