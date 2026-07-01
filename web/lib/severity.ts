/**
 * Single source of truth for issue-severity presentation across the app
 * (dashboards, run history, live QA chips). Mirrors the server's SEVERITIES
 * order in server/src/common/stats.util.ts — keep them in sync.
 */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

export type Severity = (typeof SEVERITY_ORDER)[number];

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#2563EB',
  info: '#64748B',
};
