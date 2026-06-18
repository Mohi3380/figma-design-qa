'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { API_BASE, api } from '@/lib/api';
import { RunsBarChart, SeverityPie } from '@/components/DashboardCharts';

interface RecentRun {
  id: string;
  targetUrl: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  error: string | null;
  createdAt: string;
  report: { passed: number; failed: number; frameName: string | null } | null;
}

interface Summary {
  kpis: {
    totalRuns: number;
    passRate: number | null;
    runsThisWeek: number;
    mostRecent: { status: string; createdAt: string; targetUrl: string } | null;
  };
  severity: Record<string, number>;
  series: { date: string; completed: number; failed: number }[];
  recent: RecentRun[];
}

interface Conn {
  figma: { connected: boolean };
  anthropic: { connected: boolean };
}

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function RunRow({ run }: { run: RecentRun }) {
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

function Kpi({ label, value, sub, small }: { label: string; value: React.ReactNode; sub?: string; small?: boolean }) {
  return (
    <div className="kpi-card">
      <div className="k-label">{label}</div>
      <div className={`k-value${small ? ' k-sm' : ''}`}>{value}</div>
      {sub && <div className="k-sub">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [conn, setConn] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summary, connections] = await Promise.all([
        api.get<Summary>('/dashboard/summary'),
        api.get<Conn>('/credentials/status').catch(() => null),
      ]);
      setData(summary);
      setConn(connections);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Welcome{user?.name ? `, ${user.name}` : ''}</h1>
        <Link className="btn btn-primary" href="/start-qa">+ New QA</Link>
      </div>
      <p className="dash-sub">Your Design QA activity at a glance.</p>

      {loading && (
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="kpi-skel" key={i} />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="empty-state" style={{ color: 'var(--alert-fg)' }}>Couldn&apos;t load your dashboard — {error}</div>
      )}

      {!loading && !error && data && (
        <>
          <div className="kpi-grid">
            <Kpi label="Total QA runs" value={data.kpis.totalRuns} />
            <Kpi label="Check pass rate" value={data.kpis.passRate === null ? '—' : `${data.kpis.passRate}%`} />
            <Kpi label="Runs this week" value={data.kpis.runsThisWeek} />
            {data.kpis.totalRuns > 0 ? (
              <Kpi
                label="Most recent"
                small
                value={data.kpis.mostRecent ? data.kpis.mostRecent.status.toLowerCase() : '—'}
                sub={data.kpis.mostRecent ? timeAgo(data.kpis.mostRecent.createdAt) : undefined}
              />
            ) : (
              <Kpi
                label="Integrations"
                value={`${(conn?.figma.connected ? 1 : 0) + (conn?.anthropic.connected ? 1 : 0)}/2`}
                sub="Figma · Anthropic"
              />
            )}
          </div>

          {data.kpis.totalRuns === 0 ? (
            <div className="onboard">
              <h2>Run your first Design QA</h2>
              <p>Compare a Figma frame against your live app and get a severity-graded report in minutes.</p>
              <ol className="onboard-steps">
                <li className={conn?.figma.connected ? 'done' : ''}>
                  <span className="ob-n">{conn?.figma.connected ? '✓' : '1'}</span>
                  <div>
                    <b>Connect Figma</b>
                    <span>{conn?.figma.connected ? 'Connected — runs use your own files' : 'OAuth in one click, or paste a personal token'}</span>
                  </div>
                </li>
                <li className={conn?.anthropic.connected ? 'done' : ''}>
                  <span className="ob-n">{conn?.anthropic.connected ? '✓' : '2'}</span>
                  <div>
                    <b>Add an Anthropic key</b>
                    <span>{conn?.anthropic.connected ? 'Vision adjudication enabled' : 'Optional — enables Claude vision adjudication'}</span>
                  </div>
                </li>
                <li>
                  <span className="ob-n">3</span>
                  <div>
                    <b>Paste two URLs &amp; run</b>
                    <span>Your Figma frame + your live app — progress streams live</span>
                  </div>
                </li>
              </ol>
              <Link className="btn btn-primary" href="/start-qa">Start your first QA →</Link>
            </div>
          ) : (
            <>
              <div className="charts-grid">
                <div className="chart-card">
                  <h3>Runs over time</h3>
                  <p className="c-sub">Last 30 days · completed vs failed</p>
                  <RunsBarChart series={data.series} />
                </div>
                <div className="chart-card">
                  <h3>Issues by severity</h3>
                  <p className="c-sub">Across completed runs</p>
                  <SeverityPie severity={data.severity} />
                </div>
              </div>

              <h2 className="title" style={{ textAlign: 'left' }}>Recent runs</h2>
              <div className="runs">
                {data.recent.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
