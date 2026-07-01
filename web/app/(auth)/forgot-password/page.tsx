'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (e) {
      // Backend responds identically whether or not the account exists (no
      // enumeration), so an error here is a genuine network/server failure.
      setErr(e instanceof Error ? e.message : 'Could not send a reset link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Reset your password</h1>
        {sent ? (
          <>
            <div className="auth-ok">If an account exists for {email}, a reset link is on its way. It expires in 1 hour.</div>
            <div className="auth-foot"><Link href="/login">Back to log in</Link></div>
          </>
        ) : (
          <>
            <p className="sub2">Enter your account email and we&apos;ll send you a reset link.</p>
            {err && <div className="auth-err">{err}</div>}
            <form onSubmit={onSubmit}>
              <div className="auth-field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <button className="btn btn-primary auth-btn" type="submit" disabled={busy}>
                {busy ? 'Checking…' : 'Send reset link'}
              </button>
            </form>
            <div className="auth-foot">
              <Link href="/login">Back to log in</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
