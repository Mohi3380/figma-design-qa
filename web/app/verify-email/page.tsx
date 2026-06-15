'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function Verify() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, [token]);

  if (state === 'pending') return <p className="sub2">Verifying your email…</p>;
  if (state === 'ok') return <div className="auth-ok">Your email is verified. You&apos;re all set.</div>;
  return <div className="auth-err">This verification link is invalid or has expired.</div>;
}

export default function VerifyEmailPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Email verification</h1>
        <Suspense fallback={null}>
          <Verify />
        </Suspense>
        <div className="auth-foot"><Link href="/login">Go to log in</Link></div>
      </div>
    </div>
  );
}
