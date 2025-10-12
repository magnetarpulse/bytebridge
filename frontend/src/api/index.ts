import axios from 'axios';

const api = axios.create({
  baseURL: '',  
  withCredentials: true,  
  xsrfCookieName: 'csrftoken', 
  xsrfHeaderName: 'X-CSRFToken',
  timeout: 10000
});

export function getCsrfToken(): string | undefined {
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrftoken='))
    ?.split('=')[1];
  return cookieValue;
}

/**
 * Initialize CSRF protection by fetching the token from the server.
 * This should be called once when the app initializes.
 */
export async function initializeCsrfProtection(): Promise<void> {
  try {
    await api.get('/users/csrf-token/');
  } catch (error) {
    console.error('Failed to initialize CSRF protection:', error);
  }
}

api.interceptors.response.use(
  response => response,
  async error => {
    // Handle redirect responses
    if (error.response?.status >= 300 && error.response?.status < 400) {
      console.error('Unexpected redirect from API:', error.response.headers.location);
      return Promise.reject(new Error('API returned a redirect instead of JSON'));
    }
    
    // Handle CSRF failures
    if (error.response?.status === 403 && error.response?.data?.detail?.includes('CSRF')) {
      console.error('CSRF token validation failed, token may be missing or invalid');
    }
    
    if (import.meta.env.DEV) {
      console.error('API Error:', error.response?.data || error.message);
    }
    return Promise.reject(error);
  }
);

export default api;