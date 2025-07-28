from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

class UserRegistrationForm(UserCreationForm):
    """Form for user registration with extended fields and validations."""
    
    email = forms.EmailField(required=True)
    first_name = forms.CharField(max_length=30, required=False)
    last_name = forms.CharField(max_length=30, required=False)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'first_name', 'last_name', 'password1', 'password2']
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['password1'].help_text = (
            "Your password must contain at least 10 characters including uppercase, "
            "lowercase, digits, and special characters (!@#$%^&*(),.?\":{}|<>)."
        )
    
    def clean_email(self):
        """Validate that the email is unique."""
        email = self.cleaned_data.get('email')
        if User.objects.filter(email=email).exists():
            raise ValidationError("A user with that email already exists.")
        return email
    
    def clean_password1(self):
        """Validate password using Django's password validation system."""
        password = self.cleaned_data.get('password1')
        try:
            validate_password(password, self.instance)
        except ValidationError as error:
            self.add_error('password1', error)
        return password
    
    def save(self, commit=True):
        """Override save to include email and other fields."""
        user = super().save(commit=False)
        user.email = self.cleaned_data['email']
        user.first_name = self.cleaned_data['first_name']
        user.last_name = self.cleaned_data['last_name']
        
        if commit:
            user.save()
        return user