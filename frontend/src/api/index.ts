import axios from 'axios';

const api = axios.create({
  baseURL: '',  
  withCredentials: true,  
  xsrfCookieName: 'csrftoken', 
  xsrfHeaderName: 'X-CSRFToken'
});

export function getCsrfToken(): string | undefined {
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrftoken='))
    ?.split('=')[1];
  return cookieValue;
}

api.interceptors.response.use(
  response => response,
  async error => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('API Error:', error.response?.data || error.message);
    }
    return Promise.reject(error);
  }
);

export default api;