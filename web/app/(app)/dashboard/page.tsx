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

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Kpi({
  label,
  value,
  sub,
  small,
  icon,
  accent = 'blue',
  footer,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  small?: boolean;
  icon?: React.ReactNode;
  accent?: 'blue' | 'green' | 'violet' | 'amber';
  footer?: { label: string; href: string };
}) {
  return (
    <div className={`kpi-card kpi-${accent}`}>
      <div className="kpi-body">
        {icon && <span className="k-ic">{icon}</span>}
        <div className="kpi-text">
          <span className="k-label">{label}</span>
          <span className={`k-value${small ? ' k-sm' : ''}`}>{value}</span>
          {sub && <span className="k-sub">{sub}</span>}
        </div>
      </div>
      {footer && (
        <Link className="kpi-foot" href={footer.href}>
          {footer.label}
          <span aria-hidden>→</span>
        </Link>
      )}
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
            <Kpi label="Total QA runs" value={data.kpis.totalRuns} accent="blue" icon={<Icon d="M8 5v14l11-7z" />} footer={{ label: 'View QA runs', href: '/runs' }} />
            <Kpi label="Check pass rate" value={data.kpis.passRate === null ? '—' : `${data.kpis.passRate}%`} accent="green" icon={<Icon d="M20 6 9 17l-5-5" />} footer={{ label: 'View QA runs', href: '/runs' }} />
            <Kpi
              label="Issues found"
              value={Object.values(data.severity ?? {}).reduce((a, b) => a + (b ?? 0), 0)}
              accent="amber"
              icon={<Icon d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01" />}
              footer={{ label: 'View QA runs', href: '/runs' }}
            />
            {data.kpis.totalRuns > 0 ? (
              <Kpi
                label="Most recent"
                small
                accent="violet"
                icon={<Icon d="M12 8v4l3 2M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />}
                value={data.kpis.mostRecent ? data.kpis.mostRecent.status.toLowerCase() : '—'}
                sub={data.kpis.mostRecent ? timeAgo(data.kpis.mostRecent.createdAt) : undefined}
                footer={{ label: 'View QA runs', href: '/runs' }}
              />
            ) : (
              <Kpi
                label="Integrations"
                accent="violet"
                icon={<Icon d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5" />}
                value={`${(conn?.figma.connected ? 1 : 0) + (conn?.anthropic.connected ? 1 : 0)}/2`}
                sub="Figma · Anthropic"
                footer={{ label: 'Manage', href: '/integrations' }}
              />
            )}
          </div>

          {data.kpis.totalRuns === 0 ? (
            <>
              <p className="dash-cta-line">
                No runs yet — <Link href="/start-qa">start your first QA →</Link> Here&apos;s what your report will look like.
              </p>
              <div className="dash-getstarted">
                <div className="chart-card donut-card">
                  <h3>Checks passed</h3>
                  <p className="c-sub">Your pass rate appears here after your first run</p>
                  <div className="donut-feature">
                    <div className="rp-ring big empty"><span>—</span></div>
                  </div>
                </div>

                <div className="chart-card sev-card" aria-hidden="true">
                  <h3>Issues by severity</h3>
                  <p className="c-sub">Your severity breakdown appears here after your first run</p>
                  <div className="rp-sev">
                    {['Critical', 'High', 'Medium', 'Low'].map((k) => (
                      <div className="rp-row" key={k}>
                        <span className="rp-k">{k}</span>
                        <span className="rp-bar" />
                        <span className="rp-n cell-faint">—</span>
                      </div>
                    ))}
                  </div>
                  <div className="rp-foot">Severity-graded · design / live / diff evidence · PDF &amp; HTML</div>
                </div>
              </div>
            </>
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
