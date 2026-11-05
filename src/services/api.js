import axios from 'axios';

const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const rawBaseUrl =
  import.meta.env.VITE_API_URL ||
  (isLocalhost ? '/api' : 'https://barangay-saray-backend.onrender.com');
const trimmedBaseUrl = rawBaseUrl.replace(/\/+$/, '');
const baseURL = trimmedBaseUrl.endsWith('/api') ? trimmedBaseUrl : `${trimmedBaseUrl}/api`;

const api = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  const token = window.localStorage.getItem('authToken');
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';

    if (status === 401 && url.includes('/auth/login') === false) {
      window.localStorage.removeItem('authToken');
      window.localStorage.removeItem('barangay-saray-user');

      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
