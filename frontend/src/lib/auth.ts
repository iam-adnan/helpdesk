import { create } from 'zustand';
import api from './api';

interface User {
  id: string; email: string; username: string; first_name: string; last_name: string;
  role: 'admin' | 'agent' | 'user'; department: string; phone: string; avatar: string | null; is_active: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  loadUser: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login/', { email, password });
    if (!data.tokens || !data.user) throw new Error('Invalid server response.');
    localStorage.setItem('tokens', JSON.stringify(data.tokens));
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  register: async (formData) => {
    const { data } = await api.post('/auth/register/', formData);
    if (!data.tokens || !data.user) throw new Error('Invalid server response.');
    localStorage.setItem('tokens', JSON.stringify(data.tokens));
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  logout: () => {
    localStorage.removeItem('tokens');
    localStorage.removeItem('user');
    set({ user: null });
    window.location.href = '/login';
  },

  loadUser: () => {
    try {
      const raw = localStorage.getItem('user');
      set({ user: raw ? JSON.parse(raw) : null, loading: false });
    } catch {
      localStorage.removeItem('user');
      localStorage.removeItem('tokens');
      set({ user: null, loading: false });
    }
  },
}));
