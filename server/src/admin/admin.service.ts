import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListUsersDto } from './dto/list-users.dto';

const DAY = 86_400_000;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parseBool(v?: string): boolean | undefined {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}
function authMethod(u: { googleId: string | null; passwordHash: string | null }): 'google' | 'password' | 'both' {
  if (u.googleId && u.passwordHash) return 'both';
  if (u.googleId) return 'google';
  return 'password';
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- users listing -----------------------------------------------------

  private buildWhere(dto: ListUsersDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    const and: Prisma.UserWhereInput[] = [];

    const search = dto.search?.trim();
    if (search) {
      and.push({
        OR: [
          { email: { contains: search.toLowerCase() } },
          { name: { contains: search } },
        ],
      });
    }

    const verified = parseBool(dto.verified);
    if (verified !== undefined) and.push({ emailVerified: verified });

    const disabled = parseBool(dto.disabled);
    if (disabled !== undefined) and.push(disabled ? { disabledAt: { not: null } } : { disabledAt: null });

    const figma = parseBool(dto.figma);
    if (figma === true) and.push({ credentials: { some: { provider: 'figma' } } });
    if (figma === false) and.push({ credentials: { none: { provider: 'figma' } } });

    const anthropic = parseBool(dto.anthropic);
    if (anthropic === true) and.push({ credentials: { some: { provider: 'anthropic' } } });
    if (anthropic === false) and.push({ credentials: { none: { provider: 'anthropic' } } });

    if (dto.role === 'USER' || dto.role === 'ADMIN') and.push({ role: dto.role });

    if (dto.authMethod === 'google') and.push({ googleId: { not: null } });
    if (dto.authMethod === 'password') and.push({ googleId: null, passwordHash: { not: null } });

    if (and.length) where.AND = and;
    return where;
  }

  private orderBy(dto: ListUsersDto): Prisma.UserOrderByWithRelationInput {
    const dir: Prisma.SortOrder = dto.order === 'asc' ? 'asc' : 'desc';
    switch (dto.sort) {
      case 'email':
        return { email: dir };
      case 'name':
        return { name: dir };
      case 'role':
        return { role: dir };
      case 'runs':
        return { qaJobs: { _count: dir } };
      default:
        return { createdAt: dir };
    }
  }

  async listUsers(dto: ListUsersDto) {
    const where = this.buildWhere(dto);
    const page = Math.max(1, Number(dto.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(dto.pageSize) || 20));

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: this.orderBy(dto),
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          disabledAt: true,
          avatarUrl: true,
          googleId: true,
          passwordHash: true,
          createdAt: true,
          _count: { select: { qaJobs: true } },
          credentials: { select: { provider: true } },
          qaJobs: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
    ]);

    return {
      rows: rows.map((u) => this.rowView(u)),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private rowView(u: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    emailVerified: boolean;
    disabledAt: Date | null;
    avatarUrl: string | null;
    googleId: string | null;
    passwordHash: string | null;
    createdAt: Date;
    _count: { qaJobs: number };
    credentials: { provider: string }[];
    qaJobs: { createdAt: Date }[];
  }) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: u.emailVerified,
      disabled: Boolean(u.disabledAt),
      avatarUrl: u.avatarUrl,
      authMethod: authMethod(u),
      figmaConnected: u.credentials.some((c) => c.provider === 'figma'),
      anthropicConnected: u.credentials.some((c) => c.provider === 'anthropic'),
      runCount: u._count.qaJobs,
      lastRunAt: u.qaJobs[0]?.createdAt ?? null,
      createdAt: u.createdAt,
    };
  }

  async exportUsersCsv(dto: ListUsersDto): Promise<string> {
    // Same filters/search as the table, but all matching rows (no pagination).
    const full: ListUsersDto = { ...dto, page: '1', pageSize: '100' };
    const cols = ['email', 'name', 'role', 'emailVerified', 'disabled', 'authMethod', 'figmaConnected', 'anthropicConnected', 'runCount', 'lastRunAt', 'createdAt'];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v instanceof Date ? v.toISOString() : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    // Page through everything so an unbounded admin DB still exports fully.
    for (let page = 1; ; page++) {
      const res = await this.listUsers({ ...full, page: String(page) });
      for (const r of res.rows) lines.push(cols.map((c) => esc((r as Record<string, unknown>)[c])).join(','));
      if (page >= res.pages) break;
    }
    return lines.join('\n');
  }

  // ---- user detail -------------------------------------------------------

  async getUser(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        disabledAt: true,
        avatarUrl: true,
        googleId: true,
        passwordHash: true,
        createdAt: true,
        updatedAt: true,
        credentials: { select: { provider: true, type: true, accountLabel: true, updatedAt: true } },
        _count: { select: { qaJobs: true, refreshTokens: true } },
        qaJobs: {
          select: { id: true, targetUrl: true, figmaUrl: true, status: true, createdAt: true, finishedAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!u) throw new NotFoundException('User not found.');
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: u.emailVerified,
      disabled: Boolean(u.disabledAt),
      disabledAt: u.disabledAt,
      avatarUrl: u.avatarUrl,
      authMethod: authMethod(u),
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      runCount: u._count.qaJobs,
      sessionCount: u._count.refreshTokens,
      // Connections: booleans/labels only — never the secret.
      connections: u.credentials.map((c) => ({ provider: c.provider, type: c.type, account: c.accountLabel, updatedAt: c.updatedAt })),
      recentRuns: u.qaJobs,
    };
  }

  // ---- stats / KPIs ------------------------------------------------------

  async stats(daysParam?: string) {
    const win = [7, 30, 90].includes(Number(daysParam)) ? Number(daysParam) : 30;
    const now = Date.now();
    const d7 = now - 7 * DAY;
    const d30 = now - 30 * DAY;

    const [users, jobs, reports, creds] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, createdAt: true, emailVerified: true, googleId: true, passwordHash: true, role: true, disabledAt: true },
      }),
      this.prisma.qAJob.findMany({ select: { userId: true, status: true, createdAt: true } }),
      this.prisma.qAReport.findMany({ select: { issuesBySeverity: true } }),
      this.prisma.apiCredential.findMany({ select: { userId: true, provider: true } }),
    ]);

    const figmaUsers = new Set(creds.filter((c) => c.provider === 'figma').map((c) => c.userId));
    const anthropicUsers = new Set(creds.filter((c) => c.provider === 'anthropic').map((c) => c.userId));
    const activeUsers = new Set(jobs.filter((j) => j.createdAt.getTime() >= d30).map((j) => j.userId));

    const completed = jobs.filter((j) => j.status === 'COMPLETED').length;
    const failed = jobs.filter((j) => j.status === 'FAILED').length;
    const attempted = completed + failed;

    // severity totals across all reports
    const severity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const r of reports) {
      if (!r.issuesBySeverity) continue;
      try {
        const s = JSON.parse(r.issuesBySeverity) as Record<string, number>;
        for (const k of SEVERITIES) severity[k] += s[k] ?? 0;
      } catch {
        /* ignore */
      }
    }

    // Time series for signups + runs over the selected window (7/30/90 days).
    const signupsByDay = new Map<string, number>();
    const runsByDay = new Map<string, { completed: number; failed: number; total: number }>();
    for (let i = win - 1; i >= 0; i--) {
      const key = dayKey(new Date(now - i * DAY));
      signupsByDay.set(key, 0);
      runsByDay.set(key, { completed: 0, failed: 0, total: 0 });
    }
    for (const u of users) {
      const b = signupsByDay.get(dayKey(u.createdAt));
      if (b !== undefined) signupsByDay.set(dayKey(u.createdAt), b + 1);
    }
    for (const j of jobs) {
      const bucket = runsByDay.get(dayKey(j.createdAt));
      if (!bucket) continue;
      bucket.total += 1;
      if (j.status === 'COMPLETED') bucket.completed += 1;
      else if (j.status === 'FAILED') bucket.failed += 1;
    }

    return {
      days: win,
      kpis: {
        totalUsers: users.length,
        newUsers7d: users.filter((u) => u.createdAt.getTime() >= d7).length,
        newUsers30d: users.filter((u) => u.createdAt.getTime() >= d30).length,
        verifiedPct: users.length ? Math.round((users.filter((u) => u.emailVerified).length / users.length) * 100) : 0,
        admins: users.filter((u) => u.role === 'ADMIN').length,
        disabled: users.filter((u) => u.disabledAt).length,
        figmaConnected: figmaUsers.size,
        anthropicConnected: anthropicUsers.size,
        activeUsers30d: activeUsers.size,
        totalRuns: jobs.length,
        runs7d: jobs.filter((j) => j.createdAt.getTime() >= d7).length,
        completed,
        failed,
        successRate: attempted ? Math.round((completed / attempted) * 1000) / 10 : null,
      },
      signupSeries: [...signupsByDay].map(([date, count]) => ({ date, count })),
      runSeries: [...runsByDay].map(([date, v]) => ({ date, ...v })),
      statusSplit: [
        { name: 'Completed', value: completed },
        { name: 'Failed', value: failed },
        { name: 'Running/Pending', value: jobs.length - attempted },
      ],
      severity,
      authSplit: [
        { name: 'Password', value: users.filter((u) => authMethod(u) === 'password').length },
        { name: 'Google', value: users.filter((u) => authMethod(u) === 'google').length },
        { name: 'Both', value: users.filter((u) => authMethod(u) === 'both').length },
      ],
    };
  }

  async activity() {
    const [signups, runs] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, email: true, name: true, createdAt: true, role: true },
      }),
      this.prisma.qAJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          status: true,
          targetUrl: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
      }),
    ]);
    return { signups, runs };
  }

  // ---- management actions ------------------------------------------------

  private async mustExist(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!u) throw new NotFoundException('User not found.');
  }

  async setRole(actorId: string, id: string, role: string) {
    if (role !== 'USER' && role !== 'ADMIN') throw new BadRequestException('Invalid role.');
    if (actorId === id && role !== 'ADMIN') {
      throw new ForbiddenException('You cannot remove your own admin access.');
    }
    await this.mustExist(id);
    await this.prisma.user.update({ where: { id }, data: { role } });
    return { ok: true };
  }

  async setDisabled(actorId: string, id: string, disabled: boolean) {
    if (actorId === id && disabled) throw new ForbiddenException('You cannot disable your own account.');
    await this.mustExist(id);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { disabledAt: disabled ? new Date() : null } }),
      // Disabling kills active sessions immediately.
      ...(disabled
        ? [this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })]
        : []),
    ]);
    return { ok: true };
  }

  async verifyEmail(id: string) {
    await this.mustExist(id);
    await this.prisma.user.update({ where: { id }, data: { emailVerified: true } });
    return { ok: true };
  }

  async revokeSessions(id: string) {
    await this.mustExist(id);
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true, revoked: count };
  }

  async deleteUser(actorId: string, id: string) {
    if (actorId === id) throw new ForbiddenException('You cannot delete your own account.');
    await this.mustExist(id);
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
