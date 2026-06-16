'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { FIGMA_CONNECT_URL } from './AuthProvider';

interface Status {
  figma: { oauthConfigured: boolean; connected: boolean; type: string | null; account: string | null };
  anthropic: { connected: boolean };
}

const EMPTY: Status = {
  figma: { oauthConfigured: false, connected: false, type: null, account: null },
  anthropic: { connected: false },
};

export default function ConnectionsPanel() {
  const [s, setS] = useState<Status | null>(null);

  const reload = () =>
    api
      .get<Status>('/credentials/status')
      .then(setS)
      .catch(() => setS(EMPTY));

  useEffect(() => {
    void reload();
  }, []);

  if (!s) return null;

  return (
    <div className="conn-panel">
      <FigmaCard status={s} onChange={reload} />
      <AnthropicCard status={s} onChange={reload} />
    </div>
  );
}

function FigmaCard({ status, onChange }: { status: Status; onChange: () => Promise<void> }) {
  const f = status.figma;
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function saveToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/credentials/figma/pat', { token: token.trim() });
      setToken('');
      setShowToken(false);
      await onChange();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not save the token.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.del('/credentials/figma');
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  if (f.connected) {
    return (
      <div className="conn-card connected">
        <div className="conn-head">
          <span className="conn-dot ok" />
          <b>Figma connected</b>
          <span className="conn-meta">
            {f.type === 'oauth' ? 'via your Figma login' : 'personal token'}
            {f.account ? ` · ${f.account}` : ''}
          </span>
        </div>
        <p className="conn-sub">Runs read your own Figma files. Your token is encrypted and never shown again.</p>
        <button className="link" type="button" onClick={disconnect} disabled={busy}>
          Disconnect Figma
        </button>
      </div>
    );
  }

  return (
    <div className="conn-card">
      <div className="conn-head">
        <span className="conn-dot" />
        <b>Connect Figma</b>
        <span className="conn-meta">required to run a QA</span>
      </div>
      <p className="conn-sub">
        A QA reads your design from Figma using <b>your own</b> access — there is no shared token.
      </p>

      {f.oauthConfigured && (
        <a className="btn btn-primary" href={FIGMA_CONNECT_URL}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
          </svg>
          Connect with Figma
        </a>
      )}

      {!showToken ? (
        <button
          className="link"
          type="button"
          onClick={() => setShowToken(true)}
          style={{ marginTop: f.oauthConfigured ? 10 : 0 }}
        >
          {f.oauthConfigured ? 'or paste a personal access token' : 'Paste a personal access token'}
        </button>
      ) : (
        <form onSubmit={saveToken} className="conn-form">
          <label htmlFor="figma-pat" className="conn-label">
            Figma personal access token{' '}
            <span className="conn-hint">(needs the <code>file_content:read</code> scope)</span>
          </label>
          <div className="conn-row">
            <input
              id="figma-pat"
              type="password"
              autoComplete="off"
              placeholder="figd_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
            <button className="btn btn-primary" type="submit" disabled={busy || token.trim().length < 8}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          {err && <p className="conn-err">{err}</p>}
          <p className="conn-hint">
            Create one at figma.com → Settings → Personal access tokens. We validate and encrypt it.
          </p>
        </form>
      )}
    </div>
  );
}

function AnthropicCard({ status, onChange }: { status: Status; onChange: () => Promise<void> }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/credentials/anthropic', { key: key.trim() });
      setKey('');
      await onChange();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not save the key.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.del('/credentials/anthropic');
      await onChange();
    } finally {
      setBusy(false);
    }
  }

  if (status.anthropic.connected) {
    return (
      <div className="conn-card connected">
        <div className="conn-head">
          <span className="conn-dot ok" />
          <b>Anthropic key saved</b>
          <span className="conn-meta">Claude vision enabled</span>
        </div>
        <p className="conn-sub">Vision adjudication uses your own key. It is encrypted and never shown again.</p>
        <button className="link" type="button" onClick={disconnect} disabled={busy}>
          Remove key
        </button>
      </div>
    );
  }

  return (
    <div className="conn-card">
      <div className="conn-head">
        <span className="conn-dot" />
        <b>Anthropic key</b>
        <span className="conn-meta">optional · enables Claude vision</span>
      </div>
      <p className="conn-sub">
        Add your own Anthropic API key to turn on vision adjudication. Without it, the deterministic layers still run.
      </p>
      <form onSubmit={save} className="conn-form">
        <div className="conn-row">
          <input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !key.trim().startsWith('sk-ant-')}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        {err && <p className="conn-err">{err}</p>}
      </form>
    </div>
  );
}
