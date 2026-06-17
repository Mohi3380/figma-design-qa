'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <div className="auth-err">This reset link is missing its token. Request a new one.</div>;
  }
  if (done) {
    return <div className="auth-ok">Password updated. Redirecting to log in…</div>;
  }
  return (
    <>
      {err && <div className="auth-err">{err}</div>}
      <form onSubmit={onSubmit}>
        <div className="auth-field">
          <label htmlFor="password">New password</label>
          <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <button className="btn btn-primary auth-btn" type="submit" disabled={busy}>
          {busy ? 'Updating…' : 'Set new password'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Choose a new password</h1>
        <p className="sub2">Enter a new password for your account.</p>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
        <div className="auth-foot"><Link href="/login">Back to log in</Link></div>
      </div>
    </div>
  );
}
