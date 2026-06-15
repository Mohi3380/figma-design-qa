'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { api, apiUpload } from '@/lib/api';

const MAX_AVATAR = 2 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

function initials(name: string | null | undefined, email: string): string {
  const base = name?.trim() || email;
  const parts = base.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

function NameCard() {
  const { user, reload } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
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

  return (
    <form className="profile-card" onSubmit={save}>
      <h2>Display name</h2>
      <p className="p-sub">Shown in the app and on your reports.</p>
      <div className="auth-field">
        <label htmlFor="name">Name</label>
        <input id="name" type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="profile-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save name'}
        </button>
      </div>
      {msg && <div className={`profile-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </form>
  );
}

function AvatarCard() {
  const { user, reload } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setMsg(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ALLOWED.includes(f.type)) {
      setMsg({ ok: false, text: 'Use a JPG, PNG, or WebP image.' });
      return;
    }
    if (f.size > MAX_AVATAR) {
      setMsg({ ok: false, text: 'Image must be 2 MB or smaller.' });
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function save() {
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

  const shown = preview || user?.avatarUrl;

  return (
    <div className="profile-card">
      <h2>Profile photo</h2>
      <p className="p-sub">JPG, PNG, or WebP · up to 2 MB.</p>
      <div className="avatar-row">
        <span className="avatar-lg">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" />
          ) : (
            initials(user?.name, user?.email ?? '')
          )}
        </span>
        <div className="profile-actions">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} hidden />
          <button className="btn btn-ghost" type="button" onClick={() => fileRef.current?.click()}>Choose image</button>
          {file && (
            <button className="btn btn-primary" type="button" onClick={save} disabled={busy}>
              {busy ? 'Uploading…' : 'Save photo'}
            </button>
          )}
        </div>
      </div>
      {msg && <div className={`profile-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </div>
  );
}

function PasswordCard() {
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
    <form className="profile-card" onSubmit={save}>
      <h2>{hasPassword ? 'Change password' : 'Set a password'}</h2>
      <p className="p-sub">
        {hasPassword ? 'Enter your current password and a new one.' : 'Your account uses Google sign-in. Set a password to also log in with email.'}
      </p>
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
      <div className="profile-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
        </button>
      </div>
      {msg && <div className={`profile-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}
    </form>
  );
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  async function onLogout() {
    await logout();
    router.push('/');
  }

  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Profile</h1>
      </div>
      <p className="dash-sub">{user?.email}</p>

      <div className="profile-grid">
        <AvatarCard />
        <NameCard />
        <PasswordCard />
        <div className="profile-card">
          <h2>Session</h2>
          <p className="p-sub">Sign out of this device.</p>
          <button className="btn btn-ghost" type="button" onClick={onLogout}>Log out</button>
        </div>
      </div>
    </div>
  );
}
