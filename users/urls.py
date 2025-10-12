from django.urls import path, re_path
from . import views

app_name = 'users'

urlpatterns = [
    # CSRF protection
    path('csrf-token/', views.csrf_token, name='csrf_token'),
    
    # Authentication
    path('auth-status/', views.auth_status, name='auth_status'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('register/', views.register, name='register'),
    
    # Admin status
    path('check-admin-status/', views.check_admin_status, name='check_admin_status'),
    
    # Password reset
    path('password-reset/', views.password_reset_request, name='password_reset_request'),
    
    # Password reset confirm with flexible trailing slash handling
    re_path(
        r'^password-reset-confirm/(?P<uidb64>[^/]+)/(?P<token>[^/]+)/*$',
        views.password_reset_confirm,
        name='password_reset_confirm'
    ),
    
    # User profile
    path('profile/', views.profile, name='profile'),
    path('api-tokens/', views.api_tokens, name='api_tokens'),
]