import json
import uuid
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth import logout, authenticate, login
from django.contrib.auth import views as auth_views, get_user_model
from django.utils.http import urlsafe_base64_decode
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.contrib import messages
from .forms import UserRegistrationForm
from django.db.models import Q, Prefetch
from .models import UserProfile

@ensure_csrf_cookie
def auth_status(request):
    """
    Check authentication status and return user info if authenticated
    """
    if request.user.is_authenticated:
        try:
            profile = request.user.userprofile
            auth_token = profile.auth_token
        except:
            auth_token = None
            
        is_admin = request.user.is_superuser or request.user.is_staff
        
        return JsonResponse({
            'isAuthenticated': True,
            'user': {
                'id': request.user.id,
                'username': request.user.username,
                'email': request.user.email,
                'firstName': request.user.first_name,
                'lastName': request.user.last_name,
                'is_superuser': request.user.is_superuser,
                'is_staff': request.user.is_staff,
                'isAdmin': is_admin,
                'profile': {
                    'auth_token': auth_token
                }
            }
        })
    return JsonResponse({'isAuthenticated': False})


@login_required
def check_admin_status(request):
    """
    Endpoint to check if the current user has admin privileges
    """
    is_admin = request.user.is_superuser or request.user.is_staff
    
    return JsonResponse({
        'is_admin': is_admin,
        'is_superuser': request.user.is_superuser,
        'is_staff': request.user.is_staff
    })


@ensure_csrf_cookie
def register(request):
    """
    Handle user registration process with support for both form and JSON API requests.
    
    Processes the registration submission, creates a new user account with validation,
    and redirects to the login page or returns JSON response on success.
    
    Args:
        request: The HTTP request object
        
    Returns:
        HttpResponse: Rendered registration page, redirect to login, or JSON response
    """
    # Check if this is a JSON/API request
    is_json_request = request.headers.get('Accept') == 'application/json' or \
                      request.headers.get('Content-Type') == 'application/json'
    
    if request.method == 'GET':
        # For API requests, just ensure CSRF cookie is set
        if is_json_request:
            return JsonResponse({'detail': 'CSRF cookie set'})
            
        # For regular requests, show the registration form
        form = UserRegistrationForm()
        return render(request, 'users/register.html', {'form': form})
    
    elif request.method == 'POST':
        if is_json_request:
            try:
                data = json.loads(request.body)
                form = UserRegistrationForm(data)
            except json.JSONDecodeError:
                return JsonResponse({'error': 'Invalid JSON'}, status=400)
        else:
            form = UserRegistrationForm(request.POST)
        
        if form.is_valid():
            user = form.save()
            # Create UserProfile through signal or explicitly
            
            # For API requests, return success response
            if is_json_request:
                # Log the user in automatically
                login(request, user)
                try:
                    profile = user.userprofile
                    auth_token = profile.auth_token
                except:
                    auth_token = None
                
                return JsonResponse({
                    'success': True,
                    'data': {
                        'id': user.id,
                        'username': user.username,
                        'email': user.email,
                        'firstName': user.first_name,
                        'lastName': user.last_name,
                        'profile': {
                            'auth_token': auth_token
                        }
                    }
                })
            
            # For form submissions, redirect to login with success message
            messages.success(request, 'Account created successfully! Please log in.')
            return redirect('login')
        
        # Form is not valid
        if is_json_request:
            return JsonResponse({
                'success': False,
                'error': 'Validation error',
                'errors': form.errors.as_json()
            }, status=400)
        
        # For regular form submission, re-render the form with errors
        return render(request, 'users/register.html', {'form': form})

@ensure_csrf_cookie
def password_reset_request(request):
    """
    Handle password reset request (first step of reset process).
    
    Supports both form submission and JSON API requests.
    
    Args:
        request: The HTTP request object
        
    Returns:
        HttpResponse: Rendered form, redirect, or JSON response
    """
    # Check if this is a JSON/API request
    is_json_request = request.headers.get('Accept') == 'application/json' or \
                      request.headers.get('Content-Type') == 'application/json'
    
    if request.method == 'POST':
        if is_json_request:
            try:
                data = json.loads(request.body)
                email = data.get('email', '')
            except json.JSONDecodeError:
                return JsonResponse({'error': 'Invalid JSON'}, status=400)
        else:
            email = request.POST.get('email', '')
        
        # Use Django's built-in PasswordResetForm
        form = auth_views.PasswordResetForm({'email': email})
        
        if form.is_valid():
            # Will send email using Django's password reset functionality
            form.save(
                request=request,
                use_https=request.is_secure(),
                email_template_name='users/password_reset_email.html',
                subject_template_name='users/password_reset_subject.txt',
            )
            
            if is_json_request:
                return JsonResponse({
                    'success': True,
                    'detail': 'Password reset email has been sent.'
                })
                
            messages.success(request, 'Password reset email has been sent. Please check your inbox.')
            return redirect('password_reset_done')
        
        # Form is not valid
        if is_json_request:
            return JsonResponse({
                'success': False,
                'error': 'Email not found',
            }, status=400)
        
        # Re-render the form with error for regular requests
        messages.error(request, 'Please enter a valid email address associated with an account.')
    
    # GET request or invalid POST
    if is_json_request:
        return JsonResponse({'detail': 'Send email in POST request'})
        
    # Use Django's built-in view for GET request
    return auth_views.PasswordResetView.as_view(
        template_name='users/password_reset_form.html',
        email_template_name='users/password_reset_email.html',
        subject_template_name='users/password_reset_subject.txt',
        success_url='/users/password-reset/done/'
    )(request)

@ensure_csrf_cookie
def password_reset_confirm_api(request, uidb64, token):
    """
    API endpoint for validating and handling password reset tokens.
    
    Args:
        request: The HTTP request object
        uidb64: Base64 encoded user ID
        token: Password reset token
        
    Returns:
        JsonResponse: JSON response indicating token validity or reset result
    """
    # Use Django's password reset token generator to validate token
    UserModel = get_user_model()
    token_generator = default_token_generator
    
    try:
        uid = urlsafe_base64_decode(uidb64).decode()
        user = UserModel._default_manager.get(pk=uid)
    except (TypeError, ValueError, OverflowError, UserModel.DoesNotExist):
        user = None
    
    if user is not None and token_generator.check_token(user, token):
        # Token is valid
        if request.method == 'POST':
            try:
                data = json.loads(request.body)
                new_password = data.get('new_password')
                confirm_password = data.get('confirm_password')
                
                if not new_password or not confirm_password:
                    return JsonResponse({
                        'success': False,
                        'error': 'Both password fields are required.'
                    }, status=400)
                
                if new_password != confirm_password:
                    return JsonResponse({
                        'success': False,
                        'error': 'Passwords don\'t match.'
                    }, status=400)
                
                # Validate password strength
                try:
                    validate_password(new_password, user)
                except ValidationError as e:
                    return JsonResponse({
                        'success': False,
                        'error': 'Password validation failed',
                        'errors': list(e)
                    }, status=400)
                
                # Set the new password
                user.set_password(new_password)
                user.save()
                
                return JsonResponse({
                    'success': True,
                    'detail': 'Password has been reset successfully.'
                })
                
            except json.JSONDecodeError:
                return JsonResponse({'error': 'Invalid JSON'}, status=400)
        
        # For GET requests, just validate the token
        return JsonResponse({
            'success': True,
            'detail': 'Token is valid',
            'uidb64': uidb64,
            'token': token
        })
    
    # Invalid token
    return JsonResponse({
        'success': False,
        'error': 'Invalid or expired password reset link.'
    }, status=400)


def password_reset_redirect(request, uidb64, token):
    """
    Redirect from Django's password reset URL to the React frontend URL.
    """
    # Get the frontend URL from settings or use a default (vite dev server)
    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5173')
    
    # Construct the frontend password reset URL
    redirect_url = f"{frontend_url}/password-reset/{uidb64}/{token}"
    
    return redirect(redirect_url)

@ensure_csrf_cookie
def login_view(request):
    """
    Custom login view that handles both form submissions and JSON API requests
    
    Args:
        request: The HTTP request object
        
    Returns:
        HttpResponse: Redirect, rendered page, or JSON response
    """
    # Check if this is a JSON/API request
    is_json_request = request.headers.get('Accept') == 'application/json' or \
                      request.headers.get('Content-Type') == 'application/json'
    
    # If this is just a GET request
    if request.method == 'GET':
        # For API requests, just ensure CSRF cookie is set
        if is_json_request:
            return JsonResponse({'detail': 'CSRF cookie set'})
            
        # For regular requests, show the login form
        return auth_views.LoginView.as_view(template_name='users/login.html')(request)
    
    # Handle POST request for login
    if request.method == 'POST':
        if is_json_request:
            try:
                data = json.loads(request.body)
                username = data.get('username')
                password = data.get('password')
            except json.JSONDecodeError:
                return JsonResponse({'detail': 'Invalid JSON'}, status=400)
        else:
            # Get credentials from form data
            username = request.POST.get('username')
            password = request.POST.get('password')
        
        # Authenticate user
        user = authenticate(request, username=username, password=password)
        
        if user is not None:
            # Log the user in
            login(request, user)
            
            # Get profile info
            try:
                profile = user.userprofile
                auth_token = profile.auth_token
            except:
                auth_token = None
            
            is_admin = user.is_superuser or user.is_staff
            
            # For API requests, return user data
            if is_json_request:
                return JsonResponse({
                    'user': {
                        'id': user.id,
                        'username': user.username,
                        'email': user.email,
                        'firstName': user.first_name,
                        'lastName': user.last_name,
                        'is_superuser': user.is_superuser,
                        'is_staff': user.is_staff,
                        'isAdmin': is_admin,
                        'profile': {
                            'auth_token': auth_token
                        }
                    },
                    'detail': 'Login successful'
                })
                
            # For form submissions, redirect to next or dashboard
            next_url = request.POST.get('next', 'dashboard')
            return redirect(next_url)
        
        # Handle invalid credentials
        if is_json_request:
            return JsonResponse({'detail': 'Invalid credentials'}, status=400)
            
        # For form submission
        messages.error(request, 'Invalid username or password')
        return render(request, 'users/login.html')
    
@login_required
def logout_view(request):
    """
    Handle user logout process.
    
    Process logout request on POST or display confirmation page on GET.
    For JSON requests, return JSON response.
    
    Args:
        request: The HTTP request object
        
    Returns:
        HttpResponse: Redirect to login page, confirmation page, or JSON response
    """
    # Check if this is a JSON/API request
    is_json_request = request.headers.get('Accept') == 'application/json' or \
                      request.headers.get('Content-Type') == 'application/json'
                      
    if request.method == 'POST':
        logout(request)
        
        # Return JSON for API request
        if is_json_request:
            return JsonResponse({'success': True, 'detail': 'Successfully logged out'})
            
        # Return redirect for regular form submission
        messages.success(request, 'You have been successfully logged out.')
        return redirect('login')
    
    # If GET request, show confirmation page (for regular web flow)
    # or return message for API
    if is_json_request:
        return JsonResponse({'detail': 'Requires POST request'}, status=400)
        
    return render(request, 'users/logout.html')

@login_required
def api_tokens(request):
    """
    View for managing API tokens.
    
    Displays the API token management interface.
    
    Args:
        request: The HTTP request object
        
    Returns:
        HttpResponse: Rendered API tokens page
    """
    return render(request, 'users/api_tokens.html')

@login_required
def profile(request):
    """
    Handle user profile management.
    
    Displays the user's profile information and handles token regeneration.
    
    Args:
        request: The HTTP request object
        
    Returns:
        HttpResponse: Rendered profile page
    """
    try:
        profile = request.user.userprofile
    except UserProfile.DoesNotExist:
        # This should rarely happen but just in case
        profile = UserProfile.objects.create(
            user=request.user, 
            auth_token=uuid.uuid4().hex
        )
    
    # Regenerate token if requested
    if request.method == 'POST' and 'regenerate_token' in request.POST:
        profile.auth_token = uuid.uuid4().hex
        profile.save()
        messages.success(request, 'Authentication token regenerated.')
        
    return render(request, 'users/profile.html', {'profile': profile})