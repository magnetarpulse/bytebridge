from django.urls import path
from django.contrib.auth import views as auth_views
from . import views

urlpatterns = [
    path('auth-status/', views.auth_status, name='auth_status'),
    path('check-admin-status/', views.check_admin_status, name='check_admin_status'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('register/', views.register, name='register'),
    path('profile/', views.profile, name='profile'),
    path('api-tokens/', views.api_tokens, name='api_tokens'),
    
    # Password reset URLs
    path('password-reset/', views.password_reset_request, name='password_reset'),
    path('password-reset/done/', 
         auth_views.PasswordResetDoneView.as_view(template_name='users/password_reset_done.html'), 
         name='password_reset_done'),
    
    # This pattern needs to match exactly what's in the email
    path('password-reset/<uidb64>/<token>/', 
         views.password_reset_redirect, 
         name='password_reset_redirect'),
    
    # Keep the original Django URL pattern for set-password
    path('password-reset/<uidb64>/set-password/', 
         auth_views.PasswordResetConfirmView.as_view(
             template_name='users/password_reset_confirm.html',
             success_url='/users/password-reset/complete/'
         ),
         name='password_reset_confirm'),
    path('password-reset/complete/', 
         auth_views.PasswordResetCompleteView.as_view(template_name='users/password_reset_complete.html'), 
         name='password_reset_complete'),
    
    # API endpoint for password reset confirmation
    path('password-reset-confirm-api/<uidb64>/<token>/', views.password_reset_confirm_api, name='password_reset_confirm_api'),
]