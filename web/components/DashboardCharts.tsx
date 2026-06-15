'use client';

import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const SEV_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#2563EB',
  info: '#64748B',
};

const TOOLTIP = { fontSize: 12, borderRadius: 8, border: '1px solid #cbd5e1', color: '#0f172a' };

export function RunsBarChart({ series }: { series: { date: string; completed: number; failed: number }[] }) {
  const data = series.map((s) => ({ ...s, label: s.date.slice(5) }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={4} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'rgba(148,163,184,.15)' }} />
        <Bar dataKey="completed" stackId="a" fill="#15803d" name="Completed" />
        <Bar dataKey="failed" stackId="a" fill="#dc2626" name="Failed" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SeverityPie({ severity }: { severity: Record<string, number> }) {
  const data = Object.entries(severity)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  if (!data.length) return <div className="chart-empty">No issues recorded yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={88} paddingAngle={2}>
          {data.map((d) => (
            <Cell key={d.name} fill={SEV_COLORS[d.name] ?? '#64748B'} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12, textTransform: 'capitalize' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
