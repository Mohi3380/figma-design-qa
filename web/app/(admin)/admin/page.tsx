'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { SignupsArea, RunsStacked, DonutChart, SeverityBar } from '@/components/AdminCharts';

interface Stats {
  kpis: {
    totalUsers: number;
    newUsers7d: number;
    newUsers30d: number;
    verifiedPct: number;
    admins: number;
    disabled: number;
    figmaConnected: number;
    anthropicConnected: number;
    activeUsers30d: number;
    totalRuns: number;
    runs7d: number;
    completed: number;
    failed: number;
    successRate: number | null;
  };
  signupSeries: { date: string; count: number }[];
  runSeries: { date: string; completed: number; failed: number }[];
  statusSplit: { name: string; value: number }[];
  severity: Record<string, number>;
  authSplit: { name: string; value: number }[];
}

interface Activity {
  signups: { id: string; email: string; name: string | null; createdAt: string; role: string }[];
  runs: {
    id: string;
    status: string;
    targetUrl: string;
    createdAt: string;
    user: { id: string; email: string; name: string | null };
  }[];
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
  icon,
  accent = 'blue',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: React.ReactNode;
  accent?: 'blue' | 'green' | 'violet' | 'amber';
}) {
  return (
    <div className={`kpi-card kpi-${accent}`}>
      <div className="kpi-body">
        {icon && <span className="k-ic">{icon}</span>}
        <div className="kpi-text">
          <span className="k-label">{label}</span>
          <span className="k-value">{value}</span>
          {sub && <span className="k-sub">{sub}</span>}
        </div>
      </div>
    </div>
  );
}

/** A trend chart with its own time-range filter (fetches just its series). */
function TrendCard({ kind }: { kind: 'signups' | 'runs' }) {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<Stats['signupSeries'] | Stats['runSeries'] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<Stats>(`/admin/stats?days=${days}`)
      .then((s) => {
        if (alive) setSeries(kind === 'signups' ? s.signupSeries : s.runSeries);
      })
      .catch(() => {
        if (alive) setSeries([]);
      });
    return () => {
      alive = false;
    };
  }, [days, kind]);

  const title = kind === 'signups' ? 'New signups' : 'QA runs over time';
  const sub = kind === 'signups' ? `Last ${days} days` : `Last ${days} days · completed vs failed`;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>{title}</h3>
          <p className="c-sub">{sub}</p>
        </div>
        <select className="range-select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>
      {series === null ? (
        <div className="chart-empty">Loading…</div>
      ) : kind === 'signups' ? (
        <SignupsArea data={series as Stats['signupSeries']} />
      ) : (
        <RunsStacked data={series as Stats['runSeries']} />
      )}
    </div>
  );
}

export default function AdminOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, a] = await Promise.all([api.get<Stats>('/admin/stats'), api.get<Activity>('/admin/activity')]);
      setStats(s);
      setActivity(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load admin stats.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app-page">
      <div className="dash-head">
        <h1>Dashboard</h1>
        <Link className="btn btn-ghost" href="/admin/users">Manage users →</Link>
      </div>
      <p className="dash-sub">Platform health, usage and growth at a glance.</p>

      {error && <div className="empty-state" style={{ color: 'var(--alert-fg)' }}>{error}</div>}

      {!error && !stats && (
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="kpi-skel" key={i} />
          ))}
        </div>
      )}

      {stats && (
        <>
          <div className="kpi-grid kpi-grid-4">
            <Kpi label="Total users" value={stats.kpis.totalUsers} sub={`${stats.kpis.newUsers30d} new in 30d`} accent="blue" icon={<Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />} />
            <Kpi label="Active (30d)" value={stats.kpis.activeUsers30d} sub="ran a QA recently" accent="green" icon={<Icon d="M22 12h-4l-3 9L9 3l-3 9H2" />} />
            <Kpi label="Email verified" value={`${stats.kpis.verifiedPct}%`} accent="violet" icon={<Icon d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7" />} />
            <Kpi label="Admins" value={stats.kpis.admins} sub={stats.kpis.disabled ? `${stats.kpis.disabled} disabled` : undefined} accent="amber" icon={<Icon d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" />} />
            <Kpi label="Total QA runs" value={stats.kpis.totalRuns} sub={`${stats.kpis.runs7d} in 7d`} accent="blue" icon={<Icon d="M8 5v14l11-7z" />} />
            <Kpi label="Success rate" value={stats.kpis.successRate === null ? '—' : `${stats.kpis.successRate}%`} sub={`${stats.kpis.completed}✓ / ${stats.kpis.failed}✕`} accent="green" icon={<Icon d="M20 6 9 17l-5-5" />} />
            <Kpi label="Figma connected" value={stats.kpis.figmaConnected} accent="violet" icon={<Icon d="M9 2v6M15 2v6M7 8h10v4a5 5 0 0 1-10 0zM12 17v5" />} />
            <Kpi label="Anthropic key" value={stats.kpis.anthropicConnected} accent="amber" icon={<Icon d="M21 2l-2 2m-7.6 7.6a5 5 0 1 0-2 2L13 13l2 2 2-2 2 2 2.5-2.5L17 9z" />} />
          </div>

          <div className="admin-charts">
            <TrendCard kind="signups" />
            <TrendCard kind="runs" />
          </div>
          <div className="admin-charts">
            <div className="chart-card">
              <h3>Runs by status</h3>
              <p className="c-sub">All time</p>
              <DonutChart data={stats.statusSplit} colors={['#15803d', '#dc2626', '#94a3b8']} />
            </div>
            <div className="chart-card">
              <h3>Issues by severity</h3>
              <p className="c-sub">Across all reports</p>
              <SeverityBar severity={stats.severity} />
            </div>
            <div className="chart-card">
              <h3>Sign-in method</h3>
              <p className="c-sub">How users authenticate</p>
              <DonutChart data={stats.authSplit} colors={['#1763E6', '#EA580C', '#7c3aed']} />
            </div>
          </div>
        </>
      )}

      {activity && (
        <div className="activity-grid">
          <div className="chart-card">
            <h3>Recent signups</h3>
            <div className="feed">
              {activity.signups.length === 0 && <div className="feed-empty">No users yet.</div>}
              {activity.signups.map((u) => (
                <Link key={u.id} href={`/admin/users?search=${encodeURIComponent(u.email)}`} className="feed-row">
                  <div className="feed-main">
                    <span className="feed-title">{u.name || u.email}</span>
                    <span className="feed-sub">{u.email}</span>
                  </div>
                  {u.role === 'ADMIN' && <span className="tag tag-admin">admin</span>}
                  <span className="feed-time">{timeAgo(u.createdAt)}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="chart-card">
            <h3>Recent QA runs</h3>
            <div className="feed">
              {activity.runs.length === 0 && <div className="feed-empty">No runs yet.</div>}
              {activity.runs.map((r) => (
                <div key={r.id} className="feed-row">
                  <div className="feed-main">
                    <span className="feed-title">{r.targetUrl}</span>
                    <span className="feed-sub">{r.user.name || r.user.email}</span>
                  </div>
                  <span className={`badge-status ${r.status}`}>{r.status.toLowerCase()}</span>
                  <span className="feed-time">{timeAgo(r.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
