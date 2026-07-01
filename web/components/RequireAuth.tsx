'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

/** Client-side route guard for the user app — redirects unauthenticated users
 * to /login, and admins to their own /admin portal (role separation). */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role === 'ADMIN') router.replace('/admin');
  }, [loading, user, router]);

  if (loading) return <div className="dash-loading">Loading…</div>;
  if (!user || user.role === 'ADMIN') return null;
  return <>{children}</>;
}
