'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { API_BASE, api } from '@/lib/api';
import { SEVERITY_COLORS } from '@/lib/severity';

type Status = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

interface Report {
  frameName: string | null;
  viewport: number | null;
  pointersChecked: number;
  passed: number;
  failed: number;
  matched: number;
  issuesBySeverity: Record<string, number> | null;
  hasPdf: boolean;
}

interface Run {
  id: string;
  figmaUrl: string;
  targetUrl: string;
  status: Status;
  progress: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  report: Report | null;
}

// Run history omits the non-actionable "info" tier on purpose.
const SEV = (['critical', 'high', 'medium', 'low'] as const).map((k) => ({ k, c: SEVERITY_COLORS[k] }));

function SeverityChips({ sev }: { sev: Record<string, number> | null }) {
  if (!sev) return <span className="cell-faint">—</span>;
  const shown = SEV.filter((s) => (sev[s.k] ?? 0) > 0);
  if (!shown.length) return <span className="tag tag-ok">clean</span>;
  return (
    <span className="sev-chips">
      {shown.map((s) => (
        <span key={s.k} className="sev-chip" style={{ background: s.c }} title={s.k}>
          {sev[s.k]}
        </span>
      ))}
    </span>
  );
}

export default function RunsPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Run | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setRuns(await api.get<Run[]>('/qa/jobs'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load runs.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>QA Runs</h1>
        <Link className="btn btn-primary" href="/start-qa">+ New QA</Link>
      </div>
      <p className="dash-sub">{runs ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : 'Loading…'} · view the report or download the PDF.</p>

      {error && <div className="empty-state" style={{ color: 'var(--alert-fg)' }}>{error}</div>}

      {!error && runs && runs.length === 0 && (
        <div className="empty-state">
          No runs yet — <Link href="/start-qa" style={{ color: 'var(--blue)', fontWeight: 600 }}>start your first QA</Link>.
        </div>
      )}

      {!error && runs && runs.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Status</th>
                <th>Passed / Failed</th>
                <th>Issues</th>
                <th>Run</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="row-click" onClick={() => setSelected(r)}>
                  <td>
                    <div className="cell-name">{r.targetUrl}</div>
                    <div className="cell-email">{r.report?.frameName || (r.status === 'FAILED' ? r.error : '—')}</div>
                  </td>
                  <td><span className={`badge-status ${r.status}`}>{r.status.toLowerCase()}</span></td>
                  <td>
                    {r.report ? (
                      <span><b className="pass-num">{r.report.passed}</b> / <b className="fail-num">{r.report.failed}</b></span>
                    ) : (
                      <span className="cell-faint">—</span>
                    )}
                  </td>
                  <td><SeverityChips sev={r.report?.issuesBySeverity ?? null} /></td>
                  <td>{new Date(r.createdAt).toLocaleDateString()}<span className="cell-faint"> {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.status === 'COMPLETED' ? (
                      <span className="run-actions">
                        <a className="btn btn-ghost btn-xs" href={`${API_BASE}/qa/jobs/${r.id}/report.html`} target="_blank" rel="noopener noreferrer">Report</a>
                        {r.report?.hasPdf && (
                          <a className="btn btn-ghost btn-xs" href={`${API_BASE}/qa/jobs/${r.id}/report.pdf`} target="_blank" rel="noopener noreferrer">PDF ↓</a>
                        )}
                      </span>
                    ) : (
                      <span className="cell-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <RunDrawer run={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RunDrawer({ run, onClose }: { run: Run; onClose: () => void }) {
  const rep = run.report;
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <h2>Run detail</h2>
          <button type="button" className="drawer-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          <div className="drawer-tags" style={{ marginBottom: 14 }}>
            <span className={`badge-status ${run.status}`}>{run.status.toLowerCase()}</span>
            {rep?.viewport ? <span className="tag tag-muted">{rep.viewport}px</span> : null}
            {rep?.frameName ? <span className="tag tag-muted">{rep.frameName}</span> : null}
          </div>

          <h3 className="drawer-h">URLs</h3>
          <ul className="drawer-conns">
            <li><b>Figma</b><br /><span className="run-url">{run.figmaUrl}</span></li>
            <li><b>Live app</b><br /><span className="run-url">{run.targetUrl}</span></li>
          </ul>

          {run.status === 'FAILED' && run.error && (
            <>
              <h3 className="drawer-h">Error</h3>
              <p className="drawer-err" style={{ margin: 0 }}>{run.error}</p>
            </>
          )}

          {rep && (
            <>
              <h3 className="drawer-h">Results</h3>
              <div className="drawer-stats">
                <div><b>{rep.pointersChecked}</b><span>checked</span></div>
                <div><b className="pass-num">{rep.passed}</b><span>passed</span></div>
                <div><b className="fail-num">{rep.failed}</b><span>failed</span></div>
              </div>

              <h3 className="drawer-h">Issues by severity</h3>
              {rep.issuesBySeverity ? (
                <div className="rp-sev">
                  {SEV.map((s) => {
                    const n = rep.issuesBySeverity?.[s.k] ?? 0;
                    const max = Math.max(1, ...SEV.map((x) => rep.issuesBySeverity?.[x.k] ?? 0));
                    return (
                      <div className="rp-row" key={s.k}>
                        <span className="rp-k" style={{ textTransform: 'capitalize' }}>{s.k}</span>
                        <span className="rp-bar"><i style={{ width: `${(n / max) * 100}%`, background: s.c }} /></span>
                        <span className="rp-n">{n}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="drawer-muted">No issue data.</p>
              )}
            </>
          )}

          <h3 className="drawer-h">Timing</h3>
          <ul className="drawer-conns">
            <li><b>Started</b> · {new Date(run.createdAt).toLocaleString()}</li>
            {run.finishedAt && <li><b>Finished</b> · {new Date(run.finishedAt).toLocaleString()}</li>}
          </ul>

          {run.status === 'COMPLETED' && (
            <div className="drawer-actions" style={{ marginTop: 20 }}>
              <a className="btn btn-primary" href={`${API_BASE}/qa/jobs/${run.id}/report.html`} target="_blank" rel="noopener noreferrer">Open report</a>
              {rep?.hasPdf && (
                <a className="btn btn-ghost" href={`${API_BASE}/qa/jobs/${run.id}/report.pdf`} target="_blank" rel="noopener noreferrer">Download PDF ↓</a>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
