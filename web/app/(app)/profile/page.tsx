'use client';

import { useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api, apiUpload } from '@/lib/api';

const MAX_AVATAR = 10 * 1024 * 1024;
// HEIC files often report an empty or 'image/heic' type; the server validates
// by real bytes and transcodes HEIC→JPEG, so we only block clearly-wrong types.
const isBlocked = (type: string) => type !== '' && !type.startsWith('image/');
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

function initials(name: string | null | undefined, email: string): string {
  const base = name?.trim() || email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

/** The consolidated account card: avatar (inline edit) + identity + display name. */
function AccountCard() {
  const { user, reload } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (isBlocked(f.type)) return setMsg({ ok: false, text: 'Please choose an image file.' });
    if (f.size > MAX_AVATAR) return setMsg({ ok: false, text: 'Image must be 10 MB or smaller.' });
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function savePhoto() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiUpload('/users/me/avatar', form);
      await reload();
      setFile(null);
      setPreview(null);
      setMsg({ ok: true, text: 'Photo updated.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Upload failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.patch('/users/me', { name: name.trim() });
      await reload();
      setMsg({ ok: true, text: 'Name updated.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not update name.' });
    } finally {
      setBusy(false);
    }
  }

  const shown = preview || user?.avatarUrl;
  const nameChanged = name.trim() !== (user?.name ?? '').trim();

  return (
    <div className="account-card">
      <div className="account-head">
        <div className="avatar-edit">
          <span className="avatar-xl">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt="" />
            ) : (
              initials(user?.name, user?.email ?? '')
            )}
          </span>
          <button type="button" className="avatar-change" onClick={() => fileRef.current?.click()} aria-label="Change photo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </button>
          <input ref={fileRef} type="file" accept={AVATAR_ACCEPT} onChange={pick} hidden />
        </div>

        <div className="account-body">
          <div className="profile-hero-tags">
            <span className={`tag ${user?.role === 'ADMIN' ? 'tag-admin' : 'tag-muted'}`}>{(user?.role ?? 'user').toLowerCase()}</span>
            {user?.emailVerified ? <span className="tag tag-ok">verified</span> : <span className="tag tag-warn">unverified</span>}
            {user?.createdAt && <span className="profile-hero-since">Joined {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>}
          </div>

          {file && (
            <div className="account-photo-save">
              <span>New photo selected · JPG, PNG, WebP or HEIC, up to 10 MB.</span>
              <button className="btn btn-primary" type="button" onClick={savePhoto} disabled={busy}>{busy ? 'Uploading…' : 'Save photo'}</button>
              <button className="btn btn-ghost" type="button" onClick={() => { setFile(null); setPreview(null); }}>Cancel</button>
            </div>
          )}

          <form className="account-fields" onSubmit={saveName}>
            <div className="field-grid">
              <div className="auth-field">
                <label htmlFor="dn">Name</label>
                <input id="dn" type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                <span className="profile-hint">Shown in the app and on your reports.</span>
              </div>
              <div className="auth-field">
                <label htmlFor="em">Email</label>
                <input id="em" type="email" value={user?.email ?? ''} readOnly className="input-readonly" />
                <span className="profile-hint">Your email can&apos;t be changed.</span>
              </div>
            </div>
            <div className="profile-actions">
              <button className="btn btn-primary" type="submit" disabled={busy || !name.trim() || !nameChanged}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
            {msg && <div className={`profile-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
          </form>
        </div>
      </div>
    </div>
  );
}

/** Change-password as a collapsible FAQ-style accordion. */
function PasswordAccordion() {
  const { user } = useAuth();
  const hasPassword = user?.hasPassword !== false;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg({ ok: false, text: 'New password must be at least 8 characters.' });
    if (next !== confirm) return setMsg({ ok: false, text: 'New passwords do not match.' });
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current || undefined, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setMsg({ ok: true, text: 'Password changed.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not change password.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="faq-item profile-faq">
      <summary>{hasPassword ? 'Change password' : 'Set a password'}</summary>
      <div className="profile-faq-body">
        <p className="p-sub">
          {hasPassword ? 'Enter your current password and a new one.' : 'Your account uses Google sign-in. Set a password to also log in with email.'}
        </p>
        <form onSubmit={save}>
          {hasPassword && (
            <div className="auth-field">
              <label htmlFor="cur">Current password</label>
              <input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </div>
          )}
          <div className="auth-field">
            <label htmlFor="np">New password</label>
            <input id="np" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="auth-field">
            <label htmlFor="cp">Confirm new password</label>
            <input id="cp" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
          </button>
          {msg && <div className={`profile-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
        </form>
      </div>
    </details>
  );
}

export default function ProfilePage() {
  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Profile</h1>
      </div>
      <p className="dash-sub">Manage your account, photo and security.</p>

      <AccountCard />

      <h2 className="profile-section-title">Security</h2>
      <div className="faq-list profile-faqs">
        <PasswordAccordion />
      </div>
    </div>
  );
}
