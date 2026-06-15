'use client';

import { useCallback, useEffect, useState } from 'react';
import RequireAuth from '@/components/RequireAuth';
import QAForm from '@/components/QAForm';
import FigmaConnect from '@/components/FigmaConnect';
import { useAuth } from '@/components/AuthProvider';
import { API_BASE, api } from '@/lib/api';

interface Run {
  id: string;
  figmaUrl: string;
  targetUrl: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  error: string | null;
  createdAt: string;
  report: { passed: number; failed: number; frameName: string | null; hasPdf: boolean } | null;
}

function RunRow({ run }: { run: Run }) {
  return (
    <div className="run-row">
      <div className="u">
        <div className="url">{run.targetUrl}</div>
        <div className="meta">
          {new Date(run.createdAt).toLocaleString()}
          {run.report?.frameName ? ` · ${run.report.frameName}` : ''}
          {run.status === 'FAILED' && run.error ? ` · ${run.error}` : ''}
        </div>
      </div>
      {run.report && run.status === 'COMPLETED' && (
        <span className="counts">
          <b className="pass">{run.report.passed}</b> passed · <b className="fail">{run.report.failed}</b> failed
        </span>
      )}
      <span className={`badge-status ${run.status}`}>{run.status.toLowerCase()}</span>
      {run.status === 'COMPLETED' && (
        <a className="btn btn-ghost" href={`${API_BASE}/qa/jobs/${run.id}/report.html`} target="_blank" rel="noopener noreferrer">
          Report
        </a>
      )}
    </div>
  );
}

function DashboardInner() {
  const { user } = useAuth();
  const [runs, setRuns] = useState<Run[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await api.get<Run[]>('/qa/jobs'));
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="dash">
      <div className="wrap">
        <div className="dash-head">
          <h1>Welcome{user?.name ? `, ${user.name}` : ''}</h1>
        </div>
        <p className="dash-sub">Run a Design QA and review your past reports.</p>

        <FigmaConnect />
        <QAForm onComplete={load} />

        <h2 className="title" style={{ textAlign: 'left', marginTop: 44 }}>Past runs</h2>
        {runs === null ? (
          <div className="empty-state">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="empty-state">No runs yet — start your first QA above.</div>
        ) : (
          <div className="runs">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardInner />
    </RequireAuth>
  );
}
