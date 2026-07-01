import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dayKey } from '../common/stats.util';

const DAY = 86_400_000;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string) {
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY);
    // Start of the earliest day shown in the 30-day series (UTC midnight) so the
    // windowed query below captures every job that falls in a visible bucket.
    const windowStart = new Date(`${dayKey(new Date(now - 29 * DAY))}T00:00:00.000Z`);

    const [totalRuns, completedCount, failedCount, runsThisWeek, reports, windowJobs, recent] = await Promise.all([
      this.prisma.qAJob.count({ where: { userId } }),
      this.prisma.qAJob.count({ where: { userId, status: 'COMPLETED' } }),
      this.prisma.qAJob.count({ where: { userId, status: 'FAILED' } }),
      this.prisma.qAJob.count({ where: { userId, createdAt: { gte: weekAgo } } }),
      // Pass-rate + severity totals across all of this user's reports, summed
      // DB-side over the denormalized columns — no longer loads + parses every
      // report row into memory on each dashboard load.
      this.prisma.qAReport.aggregate({
        where: { job: { userId } },
        _sum: {
          pointersChecked: true,
          passed: true,
          sevCritical: true,
          sevHigh: true,
          sevMedium: true,
          sevLow: true,
          sevInfo: true,
        },
      }),
      // Only the last 30 days are needed for the run series.
      this.prisma.qAJob.findMany({
        where: { userId, createdAt: { gte: windowStart } },
        select: { createdAt: true, status: true },
      }),
      this.prisma.qAJob.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          targetUrl: true,
          status: true,
          error: true,
          createdAt: true,
          report: { select: { passed: true, failed: true, frameName: true } },
        },
      }),
    ]);

    // Check-level pass rate + severity totals across completed runs.
    const checked = reports._sum.pointersChecked ?? 0;
    const passed = reports._sum.passed ?? 0;
    const severity = {
      critical: reports._sum.sevCritical ?? 0,
      high: reports._sum.sevHigh ?? 0,
      medium: reports._sum.sevMedium ?? 0,
      low: reports._sum.sevLow ?? 0,
      info: reports._sum.sevInfo ?? 0,
    };
    const passRate = checked > 0 ? Math.round((passed / checked) * 1000) / 10 : null;

    // Runs per day for the last 30 days (completed vs failed).
    const series: { date: string; completed: number; failed: number; total: number }[] = [];
    const byDay = new Map<string, { completed: number; failed: number; total: number }>();
    for (let i = 29; i >= 0; i--) {
      const key = dayKey(new Date(now - i * DAY));
      byDay.set(key, { completed: 0, failed: 0, total: 0 });
    }
    for (const j of windowJobs) {
      const bucket = byDay.get(dayKey(j.createdAt));
      if (!bucket) continue; // older than 30 days
      bucket.total += 1;
      if (j.status === 'COMPLETED') bucket.completed += 1;
      else if (j.status === 'FAILED') bucket.failed += 1;
    }
    for (const [date, v] of byDay) series.push({ date, ...v });

    const mostRecent = recent[0]
      ? { status: recent[0].status, createdAt: recent[0].createdAt, targetUrl: recent[0].targetUrl }
      : null;

    return {
      kpis: {
        totalRuns,
        passRate, // percent or null when nothing checked yet
        runsThisWeek,
        mostRecent,
        completedCount,
        failedCount,
      },
      severity,
      series,
      recent: recent.map((j) => ({
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
