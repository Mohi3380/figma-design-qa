'use client';

import ConnectionsPanel from '@/components/ConnectionsPanel';

export default function IntegrationsPage() {
  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Integrations</h1>
      </div>
      <p className="dash-sub">
        Connect your own Figma access and (optionally) an Anthropic key. Credentials are encrypted at rest,
        used only for your own runs, and never shared between accounts.
      </p>
      <ConnectionsPanel />
    </div>
  );
}
