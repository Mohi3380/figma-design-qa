'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, API_BASE } from '@/lib/api';

export interface User {
  id: string;
  email: string;
  name?: string | null;
  emailVerified: boolean;
  avatarUrl?: string | null;
  hasPassword?: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Backend redirect entry points (full-page navigations, not fetch). */
export const GOOGLE_LOGIN_URL = `${API_BASE}/auth/google`;
export const FIGMA_CONNECT_URL = `${API_BASE}/figma/login`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>('/auth/me');
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const login = async (email: string, password: string) => {
    const { user } = await api.post<{ user: User }>('/auth/login', { email, password });
    setUser(user);
  };
  const signup = async (email: string, password: string, name?: string) => {
    const { user } = await api.post<{ user: User }>('/auth/signup', { email, password, name });
    setUser(user);
  };
  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, reload }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
