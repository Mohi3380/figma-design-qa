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

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="kpi-card">
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
      {sub && <div className="k-sub">{sub}</div>}
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
        <h1>Admin overview</h1>
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
            <Kpi label="Total users" value={stats.kpis.totalUsers} sub={`${stats.kpis.newUsers30d} new in 30d`} />
            <Kpi label="Active (30d)" value={stats.kpis.activeUsers30d} sub="ran a QA recently" />
            <Kpi label="Email verified" value={`${stats.kpis.verifiedPct}%`} />
            <Kpi label="Admins" value={stats.kpis.admins} sub={stats.kpis.disabled ? `${stats.kpis.disabled} disabled` : undefined} />
            <Kpi label="Total QA runs" value={stats.kpis.totalRuns} sub={`${stats.kpis.runs7d} in 7d`} />
            <Kpi label="Success rate" value={stats.kpis.successRate === null ? '—' : `${stats.kpis.successRate}%`} sub={`${stats.kpis.completed}✓ / ${stats.kpis.failed}✕`} />
            <Kpi label="Figma connected" value={stats.kpis.figmaConnected} />
            <Kpi label="Anthropic key" value={stats.kpis.anthropicConnected} />
          </div>

          <div className="admin-charts">
            <div className="chart-card">
              <h3>New signups</h3>
              <p className="c-sub">Last 30 days</p>
              <SignupsArea data={stats.signupSeries} />
            </div>
            <div className="chart-card">
              <h3>QA runs over time</h3>
              <p className="c-sub">Last 30 days · completed vs failed</p>
              <RunsStacked data={stats.runSeries} />
            </div>
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
