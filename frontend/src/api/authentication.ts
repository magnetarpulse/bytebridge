import api, { getCsrfToken, initializeCsrfProtection } from './index';

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

// Cache to store admin status and avoid repeated API calls
const adminStatusCache = {
  data: null as { isAdmin: boolean; is_superuser: boolean; is_staff: boolean } | null,
  timestamp: 0,
  ttl: 5 * 60 * 1000 // 5 minutes cache TTL
};

/**
 * Helper to ensure CSRF token is included in headers
 */
function getSecureHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers['X-CSRFToken'] = csrfToken;
  }
  
  return headers;
}

/**
 * Check if admin status cache is still valid
 */
function isAdminCacheValid(): boolean {
  return adminStatusCache.data !== null && 
         Date.now() - adminStatusCache.timestamp < adminStatusCache.ttl;
}

/**
 * Clear admin status cache
 */
function clearAdminCache(): void {
  adminStatusCache.data = null;
  adminStatusCache.timestamp = 0;
}

/**
 * Get cached admin status or fetch from API
 */
async function getAdminStatus() {
  if (isAdminCacheValid()) {
    return adminStatusCache.data;
  }
  
  try {
    const response = await api.get('/users/check-admin-status/');
    const adminData = {
      isAdmin: response.data.is_admin,
      is_superuser: response.data.is_superuser,
      is_staff: response.data.is_staff
    };
    
    adminStatusCache.data = adminData;
    adminStatusCache.timestamp = Date.now();
    
    return adminData;
  } catch (error) {
    console.error('An error occurred while checking admin status.');
    return null;
  }
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
    // Ensure CSRF token is set before making request
    await initializeCsrfProtection();
    
    const response = await api.post('/users/register/', {
      username: username,
      email: email,
      password1: password,  
      password2: password   
    }, { headers: getSecureHeaders() });
    
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
    console.error('An error occurred during registration.');
    
    let errorMessage = 'Registration failed. Please try again.';
    
    if (error.response?.data?.errors) {
      const errorsObj = error.response.data.errors;
      
      for (const field in errorsObj) {
        if (Array.isArray(errorsObj[field]) && errorsObj[field]?.length > 0) {
          const fieldErrors = errorsObj[field];
          errorMessage = fieldErrors[0] || errorMessage;
          break;
        }
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
    // Ensure CSRF token is set before making request
    await initializeCsrfProtection();
    
    await api.post('/users/password-reset/', { email }, { headers: getSecureHeaders() });
    
    return {
      success: true
    };
  } catch (error: any) {
    console.error('An error occurred while requesting the password reset.');
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
    const response = await api.get(`/users/password-reset-confirm/${uidb64}/${token}/`);
    
    return {
      success: true,
      data: response.data
    };
  } catch (error: any) {
    console.error('An error occurred while validating the password reset token.');
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
    // Ensure CSRF token is set before making request
    await initializeCsrfProtection();
    
    await api.post(`/users/password-reset-confirm/${uidb64}/${token}/`, {
      new_password: newPassword,
      confirm_password: confirmPassword
    }, { headers: getSecureHeaders() });
    
    return {
      success: true
    };
  } catch (error: any) {
    console.error('An error occurred while completing the password reset.');
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
    // Ensure CSRF token is set before making request
    await initializeCsrfProtection();
    
    // Clear admin cache on login since user context changed
    clearAdminCache();
    
    const response = await api.post('/users/login/', 
      { username, password },
      { headers: getSecureHeaders() }
    );
    
    if (response.data.user) {
      return { 
        success: true, 
        data: response.data.user 
      };
    }
    
    return { success: false, error: 'Unexpected response from server' };
  } catch (error: any) {
    console.error('An error occurred during login.');
    return { 
      success: false, 
      error: error?.response?.data?.error || 'Login failed'
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
    await api.post('/users/logout/', {}, { headers: getSecureHeaders() });
    
    // Clear admin cache on logout
    clearAdminCache();
    
    return { success: true };
  } catch (error: any) {
    console.error('An error occurred during logout.');
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
    
    // If user exists, check admin status using cached approach
    if (user) {
      const adminData = await getAdminStatus();
      if (adminData) {
        user = {
          ...user,
          is_superuser: adminData.is_superuser,
          is_staff: adminData.is_staff,
          isAdmin: adminData.isAdmin
        };
      }
    } else {
      // Clear cache if user is not authenticated
      clearAdminCache();
    }
    
    return {
      isAuthenticated: response.data.isAuthenticated,
      user
    };
  } catch (error) {
    console.error('An error occurred while checking authentication status.');
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
      
      // Get admin status using cached approach
      const adminData = await getAdminStatus();
      if (adminData) {
        user = {
          ...user,
          is_superuser: adminData.is_superuser,
          is_staff: adminData.is_staff,
          isAdmin: adminData.isAdmin
        };
      }
      
      return {
        success: true,
        data: user
      };
    }
    
    return { success: false, error: 'Not authenticated' };
  } catch (error: any) {
    console.error('An error occurred while fetching the user profile.');
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
    const adminData = await getAdminStatus();
    
    if (adminData) {
      return {
        success: true,
        data: adminData
      };
    }
    
    return {
      success: false,
      error: 'Failed to check admin status'
    };
  } catch (error: any) {
    console.error('An error occurred while checking admin status.');
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
    const headers = getSecureHeaders();
    
    await api.post('/users/profile/', {
      regenerate_token: 'true'
    }, { headers }); 
    
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
    console.error('An error occurred while regenerating the token.');
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
    await initializeCsrfProtection();
    return getCsrfToken();
  } catch (error) {
    console.error('An error occurred while refreshing the CSRF token.');
    return undefined;
  }
}