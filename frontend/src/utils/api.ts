import axios from 'axios';

const getBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  return '';
};

export const API_BASE_URL = getBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Crucial for HttpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for impersonation support
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const impersonateId = localStorage.getItem('impersonate_user_id');
    if (impersonateId) {
      config.headers['X-Impersonate-User-Id'] = impersonateId;
    }
  }
  return config;
});

// Response interceptor for handling 401s
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 401 errors are now handled by individual components instead of automatic redirect
    // This allows the landing page and other pages to work without forcing login
    return Promise.reject(error);
  }
);

export default api;
