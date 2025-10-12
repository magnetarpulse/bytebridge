import json
import uuid
import logging
from functools import wraps

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.core.mail import send_mail
from django.template.loader import render_to_string

from .models import UserProfile

logger = logging.getLogger(__name__)
User = get_user_model()


def api_login_required(view_func):
    """
    Decorator for API endpoints that require authentication.
    Returns JSON 401 instead of redirecting.
    """
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse(
                {'error': 'Authentication required'},
                status=401
            )
        return view_func(request, *args, **kwargs)
    return wrapper


def get_user_data(user):
    """
    Serialize user object to JSON-compatible dict.
    """
    try:
        profile = user.userprofile
        auth_token = profile.auth_token
    except UserProfile.DoesNotExist:
        auth_token = None
    
    is_admin = user.is_superuser or user.is_staff
    
    return {
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
    }


def parse_json_body(request):
    """
    Safely parse JSON from request body.
    Returns tuple of (data, error_response).
    """
    try:
        data = json.loads(request.body)
        return data, None
    except json.JSONDecodeError:
        return None, JsonResponse(
            {'error': 'Invalid JSON'},
            status=400
        )


@ensure_csrf_cookie
@require_http_methods(['GET'])
def csrf_token(request):
    """
    Endpoint to obtain CSRF token. Called on app initialization.
    The token is set in the cookie automatically by @ensure_csrf_cookie.
    """
    return JsonResponse({'detail': 'CSRF token set'})


@require_http_methods(['GET'])
def auth_status(request):
    """
    Check authentication status and return user info if authenticated.
    """
    if request.user.is_authenticated:
        return JsonResponse({
            'isAuthenticated': True,
            'user': get_user_data(request.user)
        })
    
    return JsonResponse({'isAuthenticated': False})


@api_login_required
@require_http_methods(['GET'])
def check_admin_status(request):
    """
    Check if the current user has admin privileges.
    """
    is_admin = request.user.is_superuser or request.user.is_staff
    
    return JsonResponse({
        'is_admin': is_admin,
        'is_superuser': request.user.is_superuser,
        'is_staff': request.user.is_staff
    })


@ensure_csrf_cookie
@csrf_protect
@require_http_methods(['POST'])
def register(request):
    """
    Register a new user via JSON API.
    
    Expected JSON payload:
    {
        "username": "string",
        "email": "string",
        "password1": "string",
        "password2": "string"
    }
    """
    data, error = parse_json_body(request)
    if error:
        return error
    
    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password1 = data.get('password1', '')
    password2 = data.get('password2', '')
    
    # Validation
    errors = {}
    
    if not username:
        errors['username'] = ['Username is required.']
    elif len(username) < 3:
        errors['username'] = ['Username must be at least 3 characters.']
    elif User.objects.filter(username=username).exists():
        errors['username'] = ['Username already taken.']
    
    if not email:
        errors['email'] = ['Email is required.']
    elif User.objects.filter(email=email).exists():
        errors['email'] = ['Email already registered.']
    
    if not password1:
        errors['password1'] = ['Password is required.']
    elif password1 != password2:
        errors['password2'] = ['Passwords do not match.']
    else:
        # Validate password strength
        try:
            validate_password(password1)
        except ValidationError as e:
            errors['password1'] = list(e.messages)
    
    if errors:
        return JsonResponse({
            'success': False,
            'error': 'Validation failed',
            'errors': errors
        }, status=400)
    
    try:
        # Create user
        user = User.objects.create_user(
            username=username,
            email=email,
            password=password1
        )
        
        # Ensure profile exists
        profile, _ = UserProfile.objects.get_or_create(
            user=user,
            defaults={'auth_token': uuid.uuid4().hex}
        )
        
        # Log user in automatically
        login(request, user)
        
        return JsonResponse({
            'success': True,
            'data': get_user_data(user)
        }, status=201)
        
    except Exception as e:
        logger.exception('Error during registration')
        return JsonResponse({
            'error': 'Registration failed. Please try again.',
            'success': False
        }, status=500)


@ensure_csrf_cookie
@csrf_protect
@require_http_methods(['POST'])
def login_view(request):
    """
    Authenticate user and create session.
    
    Expected JSON payload:
    {
        "username": "string",
        "password": "string"
    }
    """
    data, error = parse_json_body(request)
    if error:
        return error
    
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return JsonResponse({
            'error': 'Username and password required'
        }, status=400)
    
    user = authenticate(request, username=username, password=password)
    
    if user is None:
        # Log failed attempt (don't expose whether user exists)
        logger.warning(f'Failed login attempt for username: {username}')
        return JsonResponse({
            'error': 'Invalid credentials'
        }, status=401)
    
    login(request, user)
    
    return JsonResponse({
        'success': True,
        'user': get_user_data(user)
    })


@csrf_protect
@require_http_methods(['POST'])
def logout_view(request):
    """
    Log out the current user.
    """
    logout(request)
    return JsonResponse({
        'success': True,
        'detail': 'Successfully logged out'
    })


@ensure_csrf_cookie
@csrf_protect
@require_http_methods(['POST'])
def password_reset_request(request):
    """
    Request a password reset email.
    
    Expected JSON payload:
    {
        "email": "string"
    }
    """
    data, error = parse_json_body(request)
    if error:
        return error
    
    email = data.get('email', '').strip()
    
    if not email:
        return JsonResponse({
            'error': 'Email is required'
        }, status=400)
    
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # For security, don't reveal whether email exists
        logger.info(f'Password reset requested for non-existent email: {email}')
        return JsonResponse({
            'success': True,
            'detail': 'If an account exists with this email, a reset link will be sent.'
        })
    
    # Generate token and send email
    token = default_token_generator.make_token(user)
    uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
    
    try:
        _send_password_reset_email(user, uidb64, token, request)
        return JsonResponse({
            'success': True,
            'detail': 'Password reset email has been sent.'
        })
    except Exception as e:
        logger.exception('Error sending password reset email')
        return JsonResponse({
            'error': 'Failed to send reset email. Please try again later.',
            'success': False
        }, status=500)


def _send_password_reset_email(user, uidb64, token, request):
    """
    Helper to send password reset email.
    """
    frontend_url = getattr(settings, 'FRONTEND_URL', 'http://localhost:5173')
    reset_url = f"{frontend_url}/password-reset/{uidb64}/{token}"
    
    context = {
        'user': user,
        'reset_url': reset_url,
        'frontend_url': frontend_url
    }
    
    subject = 'Password Reset Request'
    message = render_to_string('users/password_reset_email.html', context)
    
    send_mail(
        subject,
        message,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        html_message=message,
        fail_silently=False
    )


@ensure_csrf_cookie
@csrf_protect
@require_http_methods(['GET', 'POST'])
def password_reset_confirm(request, uidb64, token):
    """
    Validate password reset token (GET) or complete password reset (POST).
    
    GET: Validates the token
    POST: Expected JSON payload:
    {
        "new_password": "string",
        "confirm_password": "string"
    }
    """
    print(f"Password reset confirm called with uidb64: {uidb64}, token: {token}, method: {request.method}")
    
    # Clean token of any trailing slashes
    token = token.rstrip('/')
    print(f"Token after cleaning: {token}")
    
    # Decode and validate token
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
        print(f"Decoded uid: {uid}, found user: {user.username}")
    except (TypeError, ValueError, OverflowError, User.DoesNotExist) as e:
        print(f"Error decoding token or finding user: {str(e)}")
        logger.warning(f'Invalid password reset token decode: {str(e)}')
        return JsonResponse({
            'error': 'Invalid or expired password reset link.'
        }, status=400)
    
    if not default_token_generator.check_token(user, token):
        print(f"Token validation failed for user: {user.username}")
        return JsonResponse({
            'error': 'Invalid or expired password reset link.'
        }, status=400)
    
    print(f"Token is valid for user: {user.username}")
    
    # GET: Just validate token
    if request.method == 'GET':
        print("Handling GET request: validating token")
        return JsonResponse({
            'success': True,
            'detail': 'Token is valid',
            'uidb64': uidb64,
            'token': token
        })
    
    # POST: Complete password reset
    print("Handling POST request: resetting password")
    data, error = parse_json_body(request)
    if error:
        print("Error parsing JSON body")
        return error
    
    new_password = data.get('new_password', '')
    confirm_password = data.get('confirm_password', '')
    print(f"New password provided: {bool(new_password)}, confirm: {bool(confirm_password)}")
    
    if not new_password or not confirm_password:
        print("Missing password fields")
        return JsonResponse({
            'error': 'Both password fields are required.'
        }, status=400)
    
    if new_password != confirm_password:
        print("Passwords do not match")
        return JsonResponse({
            'error': 'Passwords do not match.'
        }, status=400)
    
    # Validate password strength
    try:
        validate_password(new_password, user)
        print("Password validation passed")
    except ValidationError as e:
        print(f"Password validation failed: {list(e.messages)}")
        return JsonResponse({
            'error': 'Password validation failed',
            'errors': list(e.messages)
        }, status=400)
    
    # Set new password
    user.set_password(new_password)
    user.save()
    print(f"Password reset completed for user: {user.username}")
    
    logger.info(f'Password reset completed for user: {user.username}')
    
    return JsonResponse({
        'success': True,
        'detail': 'Password has been reset successfully.'
    })


@api_login_required
@csrf_protect
@require_http_methods(['GET', 'POST'])
def profile(request):
    """
    Get user profile or regenerate API token.
    
    GET: Returns user profile
    POST: Expected JSON payload (optional):
    {
        "regenerate_token": "true"  (optional, to regenerate API token)
    }
    """
    try:
        profile = request.user.userprofile
    except UserProfile.DoesNotExist:
        profile = UserProfile.objects.create(
            user=request.user,
            auth_token=uuid.uuid4().hex
        )
    
    if request.method == 'POST':
        data, error = parse_json_body(request)
        if error:
            return error
        
        if data.get('regenerate_token') == 'true' or data.get('regenerate_token') is True:
            profile.auth_token = uuid.uuid4().hex
            profile.save()
            logger.info(f'API token regenerated for user: {request.user.username}')
    
    return JsonResponse({
        'success': True,
        'user': get_user_data(request.user)
    })


@api_login_required
@require_http_methods(['GET'])
def api_tokens(request):
    """
    Get the user's API token.
    """
    try:
        profile = request.user.userprofile
        auth_token = profile.auth_token
    except UserProfile.DoesNotExist:
        profile = UserProfile.objects.create(
            user=request.user,
            auth_token=uuid.uuid4().hex
        )
        auth_token = profile.auth_token
    
    return JsonResponse({
        'auth_token': auth_token,
        'token_type': 'Bearer'
    })