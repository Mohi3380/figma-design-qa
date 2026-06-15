'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } catch {
      /* always succeed to avoid leaking which emails exist */
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Reset your password</h1>
        {sent ? (
          <>
            <div className="auth-ok">If an account exists for {email}, a reset link is on its way.</div>
            <div className="auth-foot"><Link href="/login">Back to log in</Link></div>
          </>
        ) : (
          <>
            <p className="sub2">Enter your email and we&apos;ll send you a reset link.</p>
            <form onSubmit={onSubmit}>
              <div className="auth-field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <button className="btn btn-primary auth-btn" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <div className="auth-foot"><Link href="/login">Back to log in</Link></div>
          </>
        )}
      </div>
    </div>
  );
}
