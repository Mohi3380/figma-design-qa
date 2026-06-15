'use client';

import { useEffect, useState } from 'react';

interface Status {
  configured: boolean;
  connected: boolean;
}

export default function FigmaConnect() {
  const [s, setS] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS({ configured: false, connected: false }));
  }, []);

  if (!s) return null;

  if (s.connected) {
    return (
      <div className="figma-banner connected">
        <span>✓ Figma connected — your files are accessible for this session.</span>
        <a href="/api/auth/logout" className="link">Disconnect</a>
      </div>
    );
  }

  if (!s.configured) {
    return (
      <div className="figma-banner">
        <span>Figma login isn&apos;t configured yet — set the OAuth env vars to enable one-click sign-in. (You can still run with a server token.)</span>
      </div>
    );
  }

  return (
    <div className="figma-banner">
      <span><b>No token needed</b> — connect your Figma account once and we handle the rest.</span>
      <a href="/api/auth/login" className="btn btn-primary">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
        Login with Figma
      </a>
    </div>
  );
}
