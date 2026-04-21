import { create } from 'zustand';
import { api } from '../api';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  industry: string;
  plan: string;
}

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  login: (email: string, password: string) => Promise<boolean>;
  register: (data: RegisterData) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  businessName: string;
  industry: string;
  subdomain: string;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tenant: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    
    try {
      const response = await api.post<{
        success: boolean;
        data: { token: string; user: User; tenant: Tenant };
      }>('/auth/login', { email, password });

      if (response.success) {
        api.setToken(response.data.token);
        set({
          user: response.data.user,
          tenant: response.data.tenant,
          isAuthenticated: true,
          isLoading: false,
        });
        return true;
      }
      
      set({ isLoading: false, error: 'Login failed' });
      return false;
    } catch (error: any) {
      set({ isLoading: false, error: error.message });
      return false;
    }
  },

  register: async (data: RegisterData) => {
    set({ isLoading: true, error: null });
    
    try {
      const response = await api.post<{
        success: boolean;
        data: { token: string; user: User; tenant: Tenant };
      }>('/auth/register', data);

      if (response.success) {
        api.setToken(response.data.token);
        set({
          user: response.data.user,
          tenant: response.data.tenant,
          isAuthenticated: true,
          isLoading: false,
        });
        return true;
      }
      
      set({ isLoading: false, error: 'Registration failed' });
      return false;
    } catch (error: any) {
      set({ isLoading: false, error: error.message });
      return false;
    }
  },

  logout: () => {
    api.setToken(null);
    set({
      user: null,
      tenant: null,
      isAuthenticated: false,
    });
  },

  checkAuth: async () => {
    const token = api.getToken();
    if (!token) {
      set({ isAuthenticated: false });
      return;
    }

    try {
      const response = await api.get<{
        success: boolean;
        data: { user: User; tenant: Tenant };
      }>('/auth/me');

      if (response.success) {
        set({
          user: response.data.user,
          tenant: response.data.tenant,
          isAuthenticated: true,
        });
      } else {
        api.setToken(null);
        set({ isAuthenticated: false });
      }
    } catch {
      api.setToken(null);
      set({ isAuthenticated: false });
    }
  },
}));
