import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { dayKey } from '../common/stats.util';
import { ListUsersDto } from './dto/list-users.dto';

const DAY = 86_400_000;

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
      // NOTE: on SQLite (the current datasource) `contains` compiles to LIKE,
      // which is case-insensitive for ASCII — so both branches already match
      // case-insensitively. Prisma's `mode: 'insensitive'` is NOT supported on
      // SQLite (it errors), so we must not add it here. When this moves to
      // Postgres, add `mode: 'insensitive'` to BOTH branches (Postgres LIKE is
      // case-sensitive) and drop the email .toLowerCase() normalization.
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

  // The columns the table + CSV both need (one definition so they can't drift).
  private static readonly ROW_SELECT = {
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
  } satisfies Prisma.UserSelect;

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
        select: AdminService.ROW_SELECT,
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
    // Same filters/search/order as the table, but all matching rows.
    const where = this.buildWhere(dto);
    const orderBy = this.orderBy(dto);
    const cols = ['email', 'name', 'role', 'emailVerified', 'disabled', 'authMethod', 'figmaConnected', 'anthropicConnected', 'runCount', 'lastRunAt', 'createdAt'];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v instanceof Date ? v.toISOString() : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    // Page through everything with skip/take. Unlike calling listUsers per page,
    // this never re-runs the (page-invariant) COUNT(*) — one findMany per page.
    const pageSize = 100;
    for (let skip = 0; ; skip += pageSize) {
      const rows = await this.prisma.user.findMany({ where, orderBy, skip, take: pageSize, select: AdminService.ROW_SELECT });
      for (const u of rows) {
        const r = this.rowView(u) as Record<string, unknown>;
        lines.push(cols.map((c) => esc(r[c])).join(','));
      }
      if (rows.length < pageSize) break;
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
    const d7 = new Date(now - 7 * DAY);
    const d30 = new Date(now - 30 * DAY);
    // Start of the earliest day shown in the series (UTC midnight) so the
    // windowed queries below capture every row that lands in a visible bucket.
    const windowStart = new Date(`${dayKey(new Date(now - (win - 1) * DAY))}T00:00:00.000Z`);

    // Scalar KPIs are computed DB-side (count/distinct) rather than by loading
    // whole tables into memory; only the per-day series + the all-time severity
    // totals fetch rows, and the series fetches are bounded to the window.
    const [
      totalUsers,
      newUsers7d,
      newUsers30d,
      verifiedCount,
      admins,
      disabled,
      passwordUsers,
      googleUsers,
      bothUsers,
      totalRuns,
      runs7d,
      completed,
      failed,
      figmaCreds,
      anthropicCreds,
      activeUserRows,
      reports,
      windowUsers,
      windowJobs,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.user.count({ where: { emailVerified: true } }),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.user.count({ where: { disabledAt: { not: null } } }),
      // authMethod(): 'password' = no Google link (regardless of password hash).
      this.prisma.user.count({ where: { googleId: null } }),
      // 'google' = linked to Google but no password set.
      this.prisma.user.count({ where: { googleId: { not: null }, passwordHash: null } }),
      // 'both' = linked to Google and has a password.
      this.prisma.user.count({ where: { googleId: { not: null }, passwordHash: { not: null } } }),
      this.prisma.qAJob.count(),
      this.prisma.qAJob.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.qAJob.count({ where: { status: 'COMPLETED' } }),
      this.prisma.qAJob.count({ where: { status: 'FAILED' } }),
      this.prisma.apiCredential.findMany({ where: { provider: 'figma' }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.apiCredential.findMany({ where: { provider: 'anthropic' }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.qAJob.findMany({ where: { createdAt: { gte: d30 } }, distinct: ['userId'], select: { userId: true } }),
      // All-time severity totals summed DB-side over the denormalized columns —
      // no longer loads + JSON-parses every report row into memory.
      this.prisma.qAReport.aggregate({
        _sum: { sevCritical: true, sevHigh: true, sevMedium: true, sevLow: true, sevInfo: true },
      }),
      this.prisma.user.findMany({ where: { createdAt: { gte: windowStart } }, select: { createdAt: true } }),
      this.prisma.qAJob.findMany({ where: { createdAt: { gte: windowStart } }, select: { createdAt: true, status: true } }),
    ]);

    const attempted = completed + failed;

    const severity: Record<string, number> = {
      critical: reports._sum.sevCritical ?? 0,
      high: reports._sum.sevHigh ?? 0,
      medium: reports._sum.sevMedium ?? 0,
      low: reports._sum.sevLow ?? 0,
      info: reports._sum.sevInfo ?? 0,
    };

    // Time series for signups + runs over the selected window (7/30/90 days).
    const signupsByDay = new Map<string, number>();
    const runsByDay = new Map<string, { completed: number; failed: number; total: number }>();
    for (let i = win - 1; i >= 0; i--) {
      const key = dayKey(new Date(now - i * DAY));
      signupsByDay.set(key, 0);
      runsByDay.set(key, { completed: 0, failed: 0, total: 0 });
    }
    for (const u of windowUsers) {
      const b = signupsByDay.get(dayKey(u.createdAt));
      if (b !== undefined) signupsByDay.set(dayKey(u.createdAt), b + 1);
    }
    for (const j of windowJobs) {
      const bucket = runsByDay.get(dayKey(j.createdAt));
      if (!bucket) continue;
      bucket.total += 1;
      if (j.status === 'COMPLETED') bucket.completed += 1;
      else if (j.status === 'FAILED') bucket.failed += 1;
    }

    return {
      days: win,
      kpis: {
        totalUsers,
        newUsers7d,
        newUsers30d,
        verifiedPct: totalUsers ? Math.round((verifiedCount / totalUsers) * 100) : 0,
        admins,
        disabled,
        figmaConnected: figmaCreds.length,
        anthropicConnected: anthropicCreds.length,
        activeUsers30d: activeUserRows.length,
        totalRuns,
        runs7d,
        completed,
        failed,
        successRate: attempted ? Math.round((completed / attempted) * 1000) / 10 : null,
      },
      signupSeries: [...signupsByDay].map(([date, count]) => ({ date, count })),
      runSeries: [...runsByDay].map(([date, v]) => ({ date, ...v })),
      statusSplit: [
        { name: 'Completed', value: completed },
        { name: 'Failed', value: failed },
        { name: 'Running/Pending', value: totalRuns - attempted },
      ],
      severity,
      authSplit: [
        { name: 'Password', value: passwordUsers },
        { name: 'Google', value: googleUsers },
        { name: 'Both', value: bothUsers },
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

  /** Guard self-destructive admin actions (no lock-out / last-admin foot-gun).
   * One place so every actor-targets-self rule is stated the same way. */
  private assertNotSelf(actorId: string, id: string, message: string) {
    if (actorId === id) throw new ForbiddenException(message);
  }

  async setRole(actorId: string, id: string, role: string) {
    if (role !== 'USER' && role !== 'ADMIN') throw new BadRequestException('Invalid role.');
    if (role !== 'ADMIN') this.assertNotSelf(actorId, id, 'You cannot remove your own admin access.');
    await this.mustExist(id);
    await this.prisma.user.update({ where: { id }, data: { role } });
    return { ok: true };
  }

  async setDisabled(actorId: string, id: string, disabled: boolean) {
    if (disabled) this.assertNotSelf(actorId, id, 'You cannot disable your own account.');
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
    this.assertNotSelf(actorId, id, 'You cannot delete your own account.');
    await this.mustExist(id);
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
