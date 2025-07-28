import api, { getCsrfToken } from './index';

export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  is_superuser?: boolean;  
  is_staff?: boolean;
  isAdmin?: boolean;      
  profile: {
    auth_token: string | null;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Register a new user
 * 
 * @param username 
 * @param email 
 * @param password 
 * @returns Promise<ApiResponse<User>>
 */
export const register = async (
  username: string, 
  email: string, 
  password: string
): Promise<ApiResponse<User>> => {
  try {
    const response = await api.post('/users/register/', {
      username: username,
      email: email,
      password1: password,  
      password2: password   
    });
    
    if (response.data && response.data.success) {
      return {
        success: true,
        data: response.data.data
      };
    }
    
    return {
      success: false,
      error: response.data?.error || 'Registration failed with an unknown error'
    };
  } catch (error: any) {
    console.error('Registration error:', error);
    
    let errorMessage = 'Registration failed. Please try again.';
    
    if (error.response?.data?.errors) {
      try {
        const errorsObj = JSON.parse(error.response.data.errors);
        
        for (const field in errorsObj) {
          if (errorsObj[field]?.length > 0) {
            const fieldErrors = errorsObj[field];
            errorMessage = fieldErrors[0].message || fieldErrors[0] || errorMessage;
            break;
          }
        }
      } catch (e) {
        errorMessage = error.response.data.error || errorMessage;
      }
    } else if (error.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
};

/**
 * Request a password reset email
 * 
 * @param email 
 * @returns Promise<ApiResponse<null>>
 */
export const requestPasswordReset = async (email: string): Promise<ApiResponse<null>> => {
  try {
    await api.post('/users/password-reset/', { email });
    
    return {
      success: true
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.error || 'Failed to send reset email. Please try again.'
    };
  }
};

/** 
 * Validate the password reset token
 * 
 * @param uidb64 
 * @param token 
 * @returns Promise<ApiResponse<null>>
 */
export const validateResetToken = async (
  uidb64: string, 
  token: string
): Promise<ApiResponse<null>> => {
  try {
    const response = await api.get(`/users/password-reset-confirm-api/${uidb64}/${token}/`);
    
    return {
      success: true,
      data: response.data
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.error || 'Invalid or expired reset link.'
    };
  }
};

/**
 * Complete the password reset process
 * 
 * @param uidb64 
 * @param token 
 * @param newPassword 
 * @param confirmPassword 
 * @returns Promise<ApiResponse<null>>
 */
export const completePasswordReset = async (
  uidb64: string,
  token: string,
  newPassword: string,
  confirmPassword: string
): Promise<ApiResponse<null>> => {
  try {
    await api.post(`/users/password-reset-confirm-api/${uidb64}/${token}/`, {
      new_password: newPassword,
      confirm_password: confirmPassword
    });
    
    return {
      success: true
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.error || 'Password reset failed. Please try again.'
    };
  }
};

/**
 * Log in a user with username and password
 * 
 * @param username
 * @param password
 * @returns Promise<ApiResponse<User>>
 */
export async function login(username: string, password: string): Promise<ApiResponse<User>> {
  try {
    await api.get('/users/login/', {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const response = await api.post('/users/login/', 
      { username, password },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    if (response.data.user) {
      return { 
        success: true, 
        data: response.data.user 
      };
    }
    
    return { success: false, error: 'Unexpected response from server' };
  } catch (error: any) {
    console.error('Login error:', error);
    return { 
      success: false, 
      error: error?.response?.data?.detail || 'Login failed'
    };
  }
}

/**
 * Log out the current user
 * 
 * @returns Promise<ApiResponse<null>>
 */
export async function logout(): Promise<ApiResponse<null>> {
  try {
    await api.post('/users/logout/');
    
    return { success: true };
  } catch (error: any) {
    console.error('Logout error:', error);
    return { 
      success: false, 
      error: error?.response?.data?.detail || 'Logout failed'
    };
  }
}

/**
 * Check if user is currently logged in
 * 
 * @returns Promise<{ isAuthenticated: boolean; user: User | null }>
 */
export async function checkAuthStatus(): Promise<{ isAuthenticated: boolean; user: User | null }> {
  try {
    const response = await api.get('/users/auth-status/');
    
    let user = response.data.isAuthenticated ? response.data.user : null;
    
    // If user exists, check admin status
    if (user) {
      try {
        const adminResponse = await api.get('/users/check-admin-status/');
        // Merge the admin status into the user object
        user = {
          ...user,
          is_superuser: adminResponse.data.is_superuser,
          is_staff: adminResponse.data.is_staff,
          isAdmin: adminResponse.data.is_admin
        };
      } catch (adminError) {
        console.error('Admin status check failed:', adminError);
        // Continue with the user object even if admin check fails
      }
    }
    
    return {
      isAuthenticated: response.data.isAuthenticated,
      user
    };
  } catch (error) {
    console.error('Auth check error:', error);
    return {
      isAuthenticated: false,
      user: null
    };
  }
}

/**
 * Get user profile with auth token
 * 
 * @returns Promise<ApiResponse<User>>
 */
export async function getUserProfile(): Promise<ApiResponse<User>> {
  try {
    const response = await api.get('/users/auth-status/');
    
    if (response.data.isAuthenticated && response.data.user) {
      let user = response.data.user;
      
      // Get admin status
      try {
        const adminResponse = await api.get('/users/check-admin-status/');
        user = {
          ...user,
          is_superuser: adminResponse.data.is_superuser,
          is_staff: adminResponse.data.is_staff,
          isAdmin: adminResponse.data.is_admin
        };
      } catch (adminError) {
        console.error('Admin status check failed:', adminError);
      }
      
      return {
        success: true,
        data: user
      };
    }
    
    return { success: false, error: 'Not authenticated' };
  } catch (error: any) {
    console.error('Get profile error:', error);
    return {
      success: false,
      error: error?.response?.data?.detail || 'Failed to fetch profile'
    };
  }
}

/**
 * Check if the current user has admin privileges
 * 
 * @returns Promise<ApiResponse<{isAdmin: boolean, is_superuser: boolean, is_staff: boolean}>>
 */
export async function checkAdminStatus(): Promise<ApiResponse<{isAdmin: boolean, is_superuser: boolean, is_staff: boolean}>> {
  try {
    const response = await api.get('/users/check-admin-status/');
    
    return {
      success: true,
      data: {
        isAdmin: response.data.is_admin,
        is_superuser: response.data.is_superuser,
        is_staff: response.data.is_staff
      }
    };
  } catch (error: any) {
    console.error('Admin status check error:', error);
    return {
      success: false,
      error: error?.response?.data?.detail || 'Failed to check admin status'
    };
  }
}

/**
 * Regenerate API token
 * 
 * @returns Promise<ApiResponse<string>>
 */
export async function regenerateToken(): Promise<ApiResponse<string>> {
  try {
    const formData = new FormData();
    formData.append('regenerate_token', 'true');
    
    await api.post('/users/profile/', formData);
    
    const profileResponse = await api.get('/users/auth-status/');
    
    if (profileResponse.data.isAuthenticated && 
        profileResponse.data.user?.profile?.auth_token) {
      return { 
        success: true, 
        data: profileResponse.data.user.profile.auth_token 
      };
    }
    
    return { success: false, error: 'Could not retrieve new token' };
  } catch (error: any) {
    console.error('Regenerate token error:', error);
    return {
      success: false,
      error: error?.response?.data?.detail || 'Failed to regenerate token'
    };
  }
}

/**
 * A function to check and refresh CSRF token if needed
 * Can be called before making important requests
 * 
 * @returns Promise<string | undefined>
 */
export async function refreshCsrfToken(): Promise<string | undefined> {
  try {
    await api.get('/users/auth-status/');
    return getCsrfToken();
  } catch (error) {
    console.error('Failed to refresh CSRF token:', error);
    return undefined;
  }
}