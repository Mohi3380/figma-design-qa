'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const TOOLTIP = { fontSize: 12, borderRadius: 8, border: '1px solid #cbd5e1', color: '#0f172a', background: '#fff' };
const SEV_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#2563EB',
  info: '#64748B',
};

export function SignupsArea({ data }: { data: { date: string; count: number }[] }) {
  const d = data.map((x) => ({ ...x, label: x.date.slice(5) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={d} margin={{ top: 8, right: 14, left: -6, bottom: 6 }}>
        <defs>
          <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1763E6" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#1763E6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} interval="preserveStartEnd" minTickGap={28} tickMargin={8} padding={{ left: 12, right: 12 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={34} />
        <Tooltip contentStyle={TOOLTIP} />
        <Area type="monotone" dataKey="count" name="Signups" stroke="#1763E6" strokeWidth={2} fill="url(#signupFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RunsStacked({ data }: { data: { date: string; completed: number; failed: number }[] }) {
  const d = data.map((x) => ({ ...x, label: x.date.slice(5) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={d} margin={{ top: 8, right: 14, left: -6, bottom: 6 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} interval="preserveStartEnd" minTickGap={28} tickMargin={8} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={34} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'rgba(148,163,184,.15)' }} />
        <Bar dataKey="completed" stackId="a" fill="#15803d" name="Completed" />
        <Bar dataKey="failed" stackId="a" fill="#dc2626" name="Failed" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
  const d = data.filter((x) => x.value > 0);
  if (!d.length) return <div className="chart-empty">No data yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={d} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={88} paddingAngle={2}>
          {d.map((x, i) => (
            <Cell key={x.name} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SeverityBar({ severity }: { severity: Record<string, number> }) {
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const data = order.map((k) => ({ name: k, value: severity[k] ?? 0 }));
  if (!data.some((d) => d.value > 0)) return <div className="chart-empty">No issues recorded yet.</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'rgba(148,163,184,.15)' }} />
        <Bar dataKey="value" name="Issues" radius={[4, 4, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.name} fill={SEV_COLORS[d.name]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
