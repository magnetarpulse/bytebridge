from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from api.viewsets import (
    ByteBridgeInstanceViewSet, DataStoreViewSet,
    BucketViewSet, ObjectViewSet
)
from api.authentication import (
    ByteBridgeTokenView, 
    ByteBridgeTokenRevokeView,
    ByteBridgeAPIKeyView,
    ByteBridgeTokenVerificationView
)
from . import views

router = DefaultRouter()
router.register(r'instances', ByteBridgeInstanceViewSet, basename='instance')
router.register(r'datastores', DataStoreViewSet, basename='datastore')
router.register(r'buckets', BucketViewSet, basename='bucket')
router.register(r'objects', ObjectViewSet, basename='object')

urlpatterns = [
    path('', include(router.urls)),
    
    # Authentication URLs
    path('auth/', include('rest_framework.urls')),
    path('auth/jwt/', ByteBridgeTokenView.as_view(), name='token_obtain_pair'),
    path('auth/jwt/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/jwt/revoke/', ByteBridgeTokenRevokeView.as_view(), name='token_revoke'),
    path('auth/jwt/verify/', ByteBridgeTokenVerificationView.as_view(), name='token_verify'),
    path('auth/apikey/', ByteBridgeAPIKeyView.as_view(), name='api_key_generate'),

    # Simple GET resources implementation
    path('direct/datastores/', views.api_get_datastores, name='api_get_datastores'),
    path('direct/buckets/', views.api_get_buckets, name='api_get_buckets'),
    path('direct/objects/', views.api_get_objects, name='api_get_objects'),

    # Simple POST resources implementation
    path('upload/', views.upload_file_view, name='api-upload'),
    path('upload/initialize/', views.initialize_upload, name='api-upload-initialize'),
    path('upload/chunk/', views.upload_chunk, name='api-upload-chunk'),
    path('upload/complete/', views.complete_upload, name='api-upload-complete'),
]