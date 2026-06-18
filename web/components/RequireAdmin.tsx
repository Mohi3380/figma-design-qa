'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

/** Route guard for the admin area — redirects non-admins (and signed-out users). */
export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'ADMIN') router.replace('/dashboard');
  }, [loading, user, router]);

  if (loading) return <div className="dash-loading">Loading…</div>;
  if (!user || user.role !== 'ADMIN') return null;
  return <>{children}</>;
}
