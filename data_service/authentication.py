import requests
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

class CentralAuthServiceAuthentication(BaseAuthentication):
    """
    Custom authentication that verifies tokens via Neurobazaar's authentication service.
    """

    def authenticate(self, request):
        token = request.COOKIES.get("access_token")  #  Get token from cookies

        if not token:
            print(" No token found in cookies.")
            return None  # No token, no authentication

        try:
            #  Log token for debugging
            print(f"[0]--- Sending token to Neurobazaar: {token}")

            #  Call Neurobazaar’s verify endpoint
            auth_url = "http://127.0.0.1:8000/auth/verify/"
            headers = {"Authorization": f"Bearer {token}"}

            response = requests.get(auth_url, headers=headers)

            print(f"[1]---- Neurobazaar response: {response.status_code}, {response.text}")

            if response.status_code == 200:
                user_data = response.json()
                print(f"[2]----- Verified Token: {user_data}")  # Debugging
                return (AuthenticatedUser(user_data["user_id"], user_data["username"]), None)

            else:
                print("xxx Invalid token or user not found.")
                raise AuthenticationFailed("Invalid token or user not found")

        except requests.exceptions.RequestException:
            print("xxx Auth service unavailable.")
            raise AuthenticationFailed("Auth service unavailable")

class AuthenticatedUser:
    def __init__(self, user_id, username):
        self.id = user_id
        self.username = username
        self.is_authenticated = True  #  Make sure Django recognizes this as an authenticated user
