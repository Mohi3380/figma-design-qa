import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface Severity {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

function parseSeverity(json: string | null): Partial<Severity> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Partial<Severity>;
  } catch {
    return {};
  }
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string) {
    const jobs = await this.prisma.qAJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { report: true },
    });

    const now = Date.now();
    const weekAgo = now - 7 * 86400_000;

    const totalRuns = jobs.length;
    const completed = jobs.filter((j) => j.status === 'COMPLETED');
    const failed = jobs.filter((j) => j.status === 'FAILED');
    const runsThisWeek = jobs.filter((j) => j.createdAt.getTime() >= weekAgo).length;

    // Check-level pass rate across completed runs that produced a report.
    let checked = 0;
    let passed = 0;
    const severity: Severity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const j of completed) {
      if (!j.report) continue;
      checked += j.report.pointersChecked;
      passed += j.report.passed;
      const s = parseSeverity(j.report.issuesBySeverity);
      severity.critical += s.critical ?? 0;
      severity.high += s.high ?? 0;
      severity.medium += s.medium ?? 0;
      severity.low += s.low ?? 0;
      severity.info += s.info ?? 0;
    }
    const passRate = checked > 0 ? Math.round((passed / checked) * 1000) / 10 : null;

    // Runs per day for the last 30 days (completed vs failed).
    const series: { date: string; completed: number; failed: number; total: number }[] = [];
    const byDay = new Map<string, { completed: number; failed: number; total: number }>();
    for (let i = 29; i >= 0; i--) {
      const key = dayKey(new Date(now - i * 86400_000));
      byDay.set(key, { completed: 0, failed: 0, total: 0 });
    }
    for (const j of jobs) {
      const key = dayKey(j.createdAt);
      const bucket = byDay.get(key);
      if (!bucket) continue; // older than 30 days
      bucket.total += 1;
      if (j.status === 'COMPLETED') bucket.completed += 1;
      else if (j.status === 'FAILED') bucket.failed += 1;
    }
    for (const [date, v] of byDay) series.push({ date, ...v });

    const mostRecent = jobs[0]
      ? { status: jobs[0].status, createdAt: jobs[0].createdAt, targetUrl: jobs[0].targetUrl }
      : null;

    return {
      kpis: {
        totalRuns,
        passRate, // percent or null when nothing checked yet
        runsThisWeek,
        mostRecent,
        completedCount: completed.length,
        failedCount: failed.length,
      },
      severity,
      series,
      recent: jobs.slice(0, 8).map((j) => ({
        id: j.id,
        targetUrl: j.targetUrl,
        status: j.status,
        error: j.error,
        createdAt: j.createdAt,
        report: j.report
          ? { passed: j.report.passed, failed: j.report.failed, frameName: j.report.frameName }
          : null,
      })),
    };
  }
}
