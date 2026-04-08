import axios from 'axios';

const api = axios.create({
  baseURL: typeof window !== 'undefined' ? '/api' : 'http://backend:8000/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    try {
      const tokens = localStorage.getItem('tokens');
      if (tokens) {
        const { access } = JSON.parse(tokens);
        if (access) {
          config.headers.Authorization = `Bearer ${access}`;
        }
      }
    } catch {
      // corrupted tokens
      localStorage.removeItem('tokens');
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    // Handle network errors or 502/503/504 (backend down)
    if (!error.response) {
      const networkError = {
        response: {
          status: 0,
          data: {
            detail: 'Cannot connect to server. Please check if the service is running.',
            errors: ['Cannot connect to server. Please check if the service is running.'],
          },
        },
      };
      return Promise.reject(networkError);
    }

    // If we got HTML back (e.g., nginx 502 page), convert to a proper error
    const contentType = error.response.headers?.['content-type'] || '';
    if (contentType.includes('text/html') || (typeof error.response.data === 'string' && error.response.data.includes('<html'))) {
      error.response.data = {
        detail: `Server error (${error.response.status}). The backend may be starting up — please wait a moment and try again.`,
        errors: [`Server error (${error.response.status}). The backend may be starting up — please wait a moment and try again.`],
      };
      return Promise.reject(error);
    }

    // Token refresh on 401
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const tokensRaw = localStorage.getItem('tokens');
        if (tokensRaw) {
          const tokens = JSON.parse(tokensRaw);
          const { data } = await axios.post('/api/auth/token/refresh/', { refresh: tokens.refresh });
          const newTokens = { ...tokens, access: data.access };
          localStorage.setItem('tokens', JSON.stringify(newTokens));
          original.headers.Authorization = `Bearer ${data.access}`;
          return api(original);
        }
      } catch {
        localStorage.removeItem('tokens');
        localStorage.removeItem('user');
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
