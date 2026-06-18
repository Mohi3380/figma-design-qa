/** Shared helpers for the admin + user dashboards (kept in one place so the
 * date bucketing and severity parsing can't drift between the two services). */

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

/** UTC calendar-day key (YYYY-MM-DD) used to bucket time series. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a stored issuesBySeverity JSON blob into a counts map (never throws). */
export function parseSeverity(json: string | null): Record<string, number> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, number>;
  } catch {
    return {};
  }
}
