'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { FIGMA_CONNECT_URL } from './AuthProvider';

interface Status {
  configured: boolean;
  connected: boolean;
}

export default function FigmaConnect() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    api
      .get<Status>('/figma/status')
      .then(setS)
      .catch(() => setS({ configured: false, connected: false }));
  }, []);

  async function disconnect() {
    await api.post('/figma/disconnect');
    setS((prev) => (prev ? { ...prev, connected: false } : prev));
  }

  if (!s) return null;

  if (s.connected) {
    return (
      <div className="figma-banner connected">
        <span>✓ Figma connected — runs use your own Figma access.</span>
        <button className="link" type="button" onClick={disconnect} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          Disconnect
        </button>
      </div>
    );
  }

  if (!s.configured) {
    return (
      <div className="figma-banner">
        <span>Figma connect isn&apos;t configured on the server yet — add the Figma OAuth keys to enable one-click connect. (A server token still works if set.)</span>
      </div>
    );
  }

  return (
    <div className="figma-banner">
      <span><b>Connect your Figma</b> so a QA can read your design files — no token needed.</span>
      <a className="btn btn-primary" href={FIGMA_CONNECT_URL}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
        Connect Figma
      </a>
    </div>
  );
}
