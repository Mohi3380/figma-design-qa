'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE, api } from '@/lib/api';

interface Row {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
  disabled: boolean;
  avatarUrl: string | null;
  authMethod: 'google' | 'password' | 'both';
  figmaConnected: boolean;
  anthropicConnected: boolean;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

interface ListResp {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

interface Detail {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
  disabled: boolean;
  authMethod: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  sessionCount: number;
  connections: { provider: string; type: string; account: string | null; updatedAt: string }[];
  recentRuns: { id: string; targetUrl: string; status: string; createdAt: string; finishedAt: string | null }[];
}

const FILTERS = [
  { key: 'role', label: 'Role', opts: [['', 'All roles'], ['ADMIN', 'Admins'], ['USER', 'Users']] },
  { key: 'verified', label: 'Verified', opts: [['', 'Any'], ['true', 'Verified'], ['false', 'Unverified']] },
  { key: 'authMethod', label: 'Auth', opts: [['', 'Any'], ['password', 'Password'], ['google', 'Google']] },
  { key: 'figma', label: 'Figma', opts: [['', 'Any'], ['true', 'Connected'], ['false', 'Not connected']] },
  { key: 'anthropic', label: 'Anthropic', opts: [['', 'Any'], ['true', 'Has key'], ['false', 'No key']] },
  { key: 'disabled', label: 'Status', opts: [['', 'Any'], ['false', 'Active'], ['true', 'Disabled']] },
] as const;

const SORTS = [
  { key: 'createdAt', label: 'Joined' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
  { key: 'runs', label: 'Runs' },
] as const;

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function buildQuery(params: Record<string, string | number>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== undefined && v !== null) sp.set(k, String(v));
  }
  return sp.toString();
}

function UsersInner() {
  const initialSearch = useSearchParams().get('search') ?? '';
  const [search, setSearch] = useState(initialSearch);
  const [debounced, setDebounced] = useState(initialSearch);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const query = buildQuery({ ...filters, search: debounced, sort, order, page, pageSize: 20 });

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get<ListResp>(`/admin/users?${query}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users.');
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset to page 1 when filters/search/sort change.
  useEffect(() => {
    setPage(1);
  }, [debounced, filters, sort, order]);

  function toggleSort(key: string) {
    if (sort === key) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setOrder('desc');
    }
  }

  function exportCsv() {
    const url = `${API_BASE}/admin/users/export.csv?${buildQuery({ ...filters, search: debounced, sort, order })}`;
    window.open(url, '_blank');
  }

  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Users</h1>
        <button type="button" className="btn btn-ghost" onClick={exportCsv}>Export CSV</button>
      </div>
      <p className="dash-sub">{data ? `${data.total} user${data.total === 1 ? '' : 's'}` : 'Loading…'}</p>

      <div className="admin-toolbar">
        <div className="admin-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {FILTERS.map((f) => (
          <select key={f.key} value={filters[f.key] ?? ''} onChange={(e) => setFilters((p) => ({ ...p, [f.key]: e.target.value }))} aria-label={f.label}>
            {f.opts.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        ))}
      </div>

      {error && <div className="empty-state" style={{ color: 'var(--alert-fg)' }}>{error}</div>}

      {!error && data && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className={`th-sort${sort === 'email' ? ' on' : ''}`} onClick={() => toggleSort('email')}>
                    User {sort === 'email' && (order === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th>
                  <button type="button" className={`th-sort${sort === 'role' ? ' on' : ''}`} onClick={() => toggleSort('role')}>
                    Role {sort === 'role' && (order === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th>Status</th>
                <th>Integrations</th>
                <th>
                  <button type="button" className={`th-sort${sort === 'runs' ? ' on' : ''}`} onClick={() => toggleSort('runs')}>
                    Runs {sort === 'runs' && (order === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
                <th>
                  <button type="button" className={`th-sort${sort === 'createdAt' ? ' on' : ''}`} onClick={() => toggleSort('createdAt')}>
                    Joined {sort === 'createdAt' && (order === 'asc' ? '↑' : '↓')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((u) => (
                <tr key={u.id} onClick={() => setSelected(u.id)} className="row-click">
                  <td>
                    <div className="cell-user">
                      <span className="avatar-xs">
                        {u.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.avatarUrl} alt="" />
                        ) : (
                          (u.name?.[0] ?? u.email[0]).toUpperCase()
                        )}
                      </span>
                      <div>
                        <div className="cell-name">{u.name || '—'}</div>
                        <div className="cell-email">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`tag ${u.role === 'ADMIN' ? 'tag-admin' : 'tag-muted'}`}>{u.role.toLowerCase()}</span></td>
                  <td>
                    {u.disabled ? (
                      <span className="tag tag-danger">disabled</span>
                    ) : u.emailVerified ? (
                      <span className="tag tag-ok">verified</span>
                    ) : (
                      <span className="tag tag-warn">unverified</span>
                    )}
                  </td>
                  <td>
                    <span className="ints">
                      <span className={`int-dot${u.figmaConnected ? ' on' : ''}`} title={`Figma ${u.figmaConnected ? 'connected' : 'not connected'}`}>F</span>
                      <span className={`int-dot${u.anthropicConnected ? ' on' : ''}`} title={`Anthropic ${u.anthropicConnected ? 'key set' : 'no key'}`}>A</span>
                      <span className="int-auth">{u.authMethod}</span>
                    </span>
                  </td>
                  <td>{u.runCount}<span className="cell-faint"> · {timeAgo(u.lastRunAt)}</span></td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={6} className="table-empty">No users match these filters.</td></tr>
              )}
            </tbody>
          </table>

          <div className="admin-pager">
            <button type="button" className="btn btn-ghost" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Prev</button>
            <span>Page {data.page} of {data.pages}</span>
            <button type="button" className="btn btn-ghost" disabled={data.page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        </div>
      )}

      {selected && <UserDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      setD(await api.get<Detail>(`/admin/users/${id}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load user.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr('');
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>User detail</h2>
          <button type="button" className="drawer-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {err && <div className="drawer-err">{err}</div>}
        {!d && !err && <div className="drawer-loading">Loading…</div>}

        {d && (
          <div className="drawer-body">
            <div className="drawer-id">
              <div className="drawer-name">{d.name || '—'}</div>
              <div className="drawer-email">{d.email}</div>
              <div className="drawer-tags">
                <span className={`tag ${d.role === 'ADMIN' ? 'tag-admin' : 'tag-muted'}`}>{d.role.toLowerCase()}</span>
                {d.disabled ? <span className="tag tag-danger">disabled</span> : d.emailVerified ? <span className="tag tag-ok">verified</span> : <span className="tag tag-warn">unverified</span>}
                <span className="tag tag-muted">{d.authMethod}</span>
              </div>
            </div>

            <div className="drawer-stats">
              <div><b>{d.runCount}</b><span>runs</span></div>
              <div><b>{d.sessionCount}</b><span>sessions</span></div>
              <div><b>{new Date(d.createdAt).toLocaleDateString()}</b><span>joined</span></div>
            </div>

            <h3 className="drawer-h">Integrations</h3>
            {d.connections.length === 0 ? (
              <p className="drawer-muted">No integrations connected.</p>
            ) : (
              <ul className="drawer-conns">
                {d.connections.map((c) => (
                  <li key={c.provider}>
                    <b>{c.provider}</b> <span>({c.type})</span> {c.account ? `· ${c.account}` : ''}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="drawer-h">Recent runs</h3>
            {d.recentRuns.length === 0 ? (
              <p className="drawer-muted">No runs yet.</p>
            ) : (
              <ul className="drawer-runs">
                {d.recentRuns.map((r) => (
                  <li key={r.id}>
                    <span className={`badge-status ${r.status}`}>{r.status.toLowerCase()}</span>
                    <span className="drawer-run-url">{r.targetUrl}</span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="drawer-h">Actions</h3>
            <div className="drawer-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.patch(`/admin/users/${id}/role`, { role: d.role === 'ADMIN' ? 'USER' : 'ADMIN' }))}>
                {d.role === 'ADMIN' ? 'Demote to user' : 'Promote to admin'}
              </button>
              {!d.emailVerified && (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.post(`/admin/users/${id}/verify`))}>Force-verify email</button>
              )}
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.patch(`/admin/users/${id}/disable`, { disabled: !d.disabled }))}>
                {d.disabled ? 'Re-enable account' : 'Disable account'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => api.post(`/admin/users/${id}/revoke-sessions`))}>Revoke sessions</button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete ${d.email}? This permanently removes their account, runs and reports.`)) {
                    void act(async () => {
                      await api.del(`/admin/users/${id}`);
                      onClose();
                    });
                  }
                }}
              >
                Delete user
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="dash-loading">Loading…</div>}>
      <UsersInner />
    </Suspense>
  );
}
