'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiUpload } from '@/lib/api';

const MAX_AVATAR = 10 * 1024 * 1024;
// HEIC files often report an empty or 'image/heic' type; the server validates
// by real bytes and transcodes HEIC→JPEG, so we only block clearly-wrong types.
const BLOCKED_AVATAR = (type: string) => type !== '' && !type.startsWith('image/');
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

interface Member {
  id: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  sortOrder: number;
  visible: boolean;
}

type Draft = {
  name: string;
  role: string;
  avatarUrl: string;
  linkedinUrl: string;
  xUrl: string;
  visible: boolean;
};

const EMPTY_DRAFT: Draft = { name: '', role: '', avatarUrl: '', linkedinUrl: '', xUrl: '', visible: true };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'KL';
}

export default function AdminTeamPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setMembers(await api.get<Member[]>('/admin/team'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Move a member up/down and persist the new order.
  async function move(index: number, dir: -1 | 1) {
    if (!members) return;
    const next = index + dir;
    if (next < 0 || next >= members.length) return;
    const reordered = [...members];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    setMembers(reordered); // optimistic
    setReordering(true);
    try {
      await api.patch('/admin/team/reorder', { ids: reordered.map((m) => m.id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder.');
      await load(); // revert to server truth
    } finally {
      setReordering(false);
    }
  }

  async function toggleVisible(m: Member) {
    setMembers((prev) => prev?.map((x) => (x.id === m.id ? { ...x, visible: !x.visible } : x)) ?? prev);
    try {
      await api.patch(`/admin/team/${m.id}`, { visible: !m.visible });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update.');
      await load();
    }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.name} (${m.role}) from the team page?`)) return;
    try {
      await api.del(`/admin/team/${m.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete.');
    }
  }

  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Team Page</h1>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>+ Add member</button>
      </div>
      <p className="dash-sub">
        Manage who appears on the public{' '}
        <a href="/team" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>Our Team</a>{' '}
        page. Drag order with the arrows; hidden members stay saved but don&apos;t show publicly.
      </p>

      {error && <div className="empty-state" style={{ color: 'var(--alert-fg)' }}>{error}</div>}

      {!error && !members && <div className="dash-loading">Loading…</div>}

      {members && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Order</th>
                <th>Member</th>
                <th>Role</th>
                <th>Links</th>
                <th>Status</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button type="button" className="th-sort" disabled={reordering || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                      <button type="button" className="th-sort" disabled={reordering || i === members.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                    </div>
                  </td>
                  <td>
                    <div className="cell-user">
                      <span className="avatar-xs">
                        {m.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.avatarUrl} alt="" />
                        ) : (
                          initials(m.name)
                        )}
                      </span>
                      <div className="cell-name">{m.name}</div>
                    </div>
                  </td>
                  <td>{m.role}</td>
                  <td>
                    <span style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                      <span className={m.linkedinUrl ? 'tag tag-ok' : 'tag tag-muted'}>in</span>
                      <span className={m.xUrl ? 'tag tag-ok' : 'tag tag-muted'}>X</span>
                    </span>
                  </td>
                  <td>
                    <button type="button" className={`tag ${m.visible ? 'tag-ok' : 'tag-muted'}`} style={{ cursor: 'pointer', border: 'none' }} onClick={() => toggleVisible(m)}>
                      {m.visible ? 'visible' : 'hidden'}
                    </button>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn-ghost" onClick={() => setEditing(m)}>Edit</button>
                      <button type="button" className="btn btn-danger" onClick={() => remove(m)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr><td colSpan={6} className="table-empty">No team members yet. Add the first one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <MemberDrawer
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function MemberDrawer({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(
    member
      ? {
          name: member.name,
          role: member.role,
          avatarUrl: member.avatarUrl ?? '',
          linkedinUrl: member.linkedinUrl ?? '',
          xUrl: member.xUrl ?? '',
          visible: member.visible,
        }
      : EMPTY_DRAFT,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!f) return;
    if (BLOCKED_AVATAR(f.type)) return setErr('Please choose an image file.');
    if (f.size > MAX_AVATAR) return setErr('Image must be 10 MB or smaller.');
    setUploading(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('file', f);
      const { url } = await apiUpload<{ url: string }>('/admin/team/avatar', form);
      set('avatarUrl', url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!draft.name.trim() || !draft.role.trim()) {
      setErr('Name and role are required.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const payload = {
        name: draft.name.trim(),
        role: draft.role.trim(),
        avatarUrl: draft.avatarUrl.trim(),
        linkedinUrl: draft.linkedinUrl.trim(),
        xUrl: draft.xUrl.trim(),
        visible: draft.visible,
      };
      if (member) await api.patch(`/admin/team/${member.id}`, payload);
      else await api.post('/admin/team', payload);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>{member ? 'Edit member' : 'Add member'}</h2>
          <button type="button" className="drawer-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {err && <div className="drawer-err">{err}</div>}

        <div className="drawer-body">
          <label className="tm-field">
            <span>Name</span>
            <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" />
          </label>
          <label className="tm-field">
            <span>Role</span>
            <input value={draft.role} onChange={(e) => set('role', e.target.value)} placeholder="Head of Engineering" />
          </label>
          <div className="tm-field">
            <span>Photo <small>(optional — falls back to initials)</small></span>
            <div className="tm-uploader">
              <span className="tm-avatar">
                {draft.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.avatarUrl} alt="" />
                ) : (
                  initials(draft.name || 'Team Member')
                )}
              </span>
              <div className="tm-uploader-actions">
                <input ref={fileRef} type="file" accept={AVATAR_ACCEPT} onChange={onPickAvatar} hidden />
                <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={uploading || busy}>
                  {uploading ? 'Uploading…' : draft.avatarUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {draft.avatarUrl && (
                  <button type="button" className="btn btn-ghost" onClick={() => set('avatarUrl', '')} disabled={uploading || busy}>Remove</button>
                )}
              </div>
            </div>
            <span className="tm-hint">JPG, PNG, WebP or HEIC, up to 10 MB.</span>
          </div>
          <label className="tm-field">
            <span>LinkedIn URL <small>(optional)</small></span>
            <input value={draft.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} placeholder="https://linkedin.com/in/…" />
          </label>
          <label className="tm-field">
            <span>X (Twitter) URL <small>(optional)</small></span>
            <input value={draft.xUrl} onChange={(e) => set('xUrl', e.target.value)} placeholder="https://x.com/…" />
          </label>
          <label className="tm-check">
            <input type="checkbox" checked={draft.visible} onChange={(e) => set('visible', e.target.checked)} />
            <span>Show on the public team page</span>
          </label>

          <div className="drawer-actions row">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || uploading}>
              {busy ? 'Saving…' : member ? 'Save changes' : 'Add member'}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
