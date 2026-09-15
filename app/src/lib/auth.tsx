import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, post, queryClient, useApi } from './api';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'coordinator' | 'engineer' | 'sales' | 'stores';
  job_title: string;
  engineer_id: number | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onUnauth = () => setUser(null);
    window.addEventListener('fl:unauthorised', onUnauth);
    return () => window.removeEventListener('fl:unauthorised', onUnauth);
  }, []);

  const login = async (email: string, password: string) => {
    const r = await post<{ user: User }>('/auth/login', { email, password });
    queryClient.clear();
    setUser(r.user);
    return r.user;
  };
  const logout = async () => {
    await post('/auth/logout');
    queryClient.clear();
    setUser(null);
  };
  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export function useMeta() {
  return useApi<any>('/meta', { staleTime: 5 * 60_000 }).data;
}

export const perms = (u: User | null) => {
  const r = u?.role;
  return {
    manageJobs: ['admin', 'manager', 'coordinator'].includes(r!),
    schedule: ['admin', 'manager', 'coordinator'].includes(r!),
    quotes: ['admin', 'manager', 'sales', 'coordinator'].includes(r!),
    contracts: ['admin', 'manager', 'sales'].includes(r!),
    stock: ['admin', 'manager', 'stores', 'coordinator'].includes(r!),
    invoicing: ['admin', 'manager'].includes(r!),
    crmEdit: ['admin', 'manager', 'coordinator', 'sales'].includes(r!),
    manager: ['admin', 'manager'].includes(r!),
  };
};
