/**
 * Admin access control + management-action guards:
 *  - AdminGuard admits only ADMIN, non-disabled users.
 *  - An admin cannot demote / disable / delete THEMSELVES (no lock-out / no last-
 *    admin foot-gun).
 *  - The users list filters/searches correctly and CSV export is well-formed.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverRoot = path.resolve(__dirname, '..');
const dbFile = path.join(os.tmpdir(), `qa-admin-${process.pid}-${Date.now()}.db`);

process.env.DATABASE_URL = `file:${dbFile}`;
process.env.TOKEN_ENC_SECRET = 'test-token-encryption-secret-0123456789';

import { PrismaService } from '../src/prisma/prisma.service';
import { AdminService } from '../src/admin/admin.service';
import { AdminGuard } from '../src/auth/admin.guard';

const prisma = new PrismaService();
const admin = new AdminService(prisma);
const guard = new AdminGuard(prisma);

function ctxFor(id: string | undefined): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user: id ? { id } : undefined }) }) } as unknown as ExecutionContext;
}

let adminUser: { id: string };
let normalUser: { id: string };
let disabledAdmin: { id: string };

beforeAll(async () => {
  execSync('npx prisma migrate deploy', { cwd: serverRoot, env: { ...process.env }, stdio: 'pipe' });
  await prisma.$connect();

  adminUser = await prisma.user.create({ data: { email: 'admin@test.local', name: 'Admin', role: 'ADMIN', emailVerified: true } });
  normalUser = await prisma.user.create({ data: { email: 'user@test.local', name: 'Normal', role: 'USER' } });
  disabledAdmin = await prisma.user.create({ data: { email: 'banned@test.local', role: 'ADMIN', disabledAt: new Date() } });
  // A couple of jobs so runCount/list works.
  await prisma.qAJob.create({ data: { userId: normalUser.id, figmaUrl: 'f', targetUrl: 't', status: 'COMPLETED' } });
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const s of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(dbFile + s);
    } catch {
      /* ignore */
    }
  }
});

describe('AdminGuard', () => {
  it('admits an ADMIN user', async () => {
    await expect(guard.canActivate(ctxFor(adminUser.id))).resolves.toBe(true);
  });
  it('rejects a normal user', async () => {
    await expect(guard.canActivate(ctxFor(normalUser.id))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects a disabled admin', async () => {
    await expect(guard.canActivate(ctxFor(disabledAdmin.id))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects when there is no authenticated user', async () => {
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('self-action guards', () => {
  it('blocks an admin from demoting themselves', async () => {
    await expect(admin.setRole(adminUser.id, adminUser.id, 'USER')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks an admin from disabling themselves', async () => {
    await expect(admin.setDisabled(adminUser.id, adminUser.id, true)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('blocks an admin from deleting themselves', async () => {
    await expect(admin.deleteUser(adminUser.id, adminUser.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows acting on a different user', async () => {
    await expect(admin.setRole(adminUser.id, normalUser.id, 'ADMIN')).resolves.toEqual({ ok: true });
    await admin.setRole(adminUser.id, normalUser.id, 'USER'); // restore
  });
});

describe('users listing', () => {
  it('filters by role', async () => {
    const res = await admin.listUsers({ role: 'ADMIN' });
    expect(res.rows.every((r) => r.role === 'ADMIN')).toBe(true);
    expect(res.rows.length).toBeGreaterThanOrEqual(2);
  });
  it('searches by email', async () => {
    const res = await admin.listUsers({ search: 'user@test' });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].email).toBe('user@test.local');
    expect(res.rows[0].runCount).toBe(1);
  });
  it('exports CSV with a header and one row per user', async () => {
    const csv = await admin.exportUsersCsv({});
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('email');
    expect(lines.length).toBe(1 + 3); // header + 3 users
  });

  it('labels and filters auth method consistently, and never leaks secrets', async () => {
    // A user linked to Google AND with a local password = 'both'.
    const both = await prisma.user.create({
      data: { email: 'both@test.local', googleId: 'g-both', passwordHash: 'hash', emailVerified: true },
    });

    const detail = await admin.getUser(both.id);
    expect(detail.authMethod).toBe('both');
    // Sensitive columns selected for classification must not reach the output.
    expect(JSON.stringify(detail)).not.toMatch(/passwordHash|googleId|hash|g-both/);

    // The 'google' filter must match the LABEL (google-only), excluding 'both'.
    const googleRows = (await admin.listUsers({ authMethod: 'google' })).rows;
    expect(googleRows.some((r) => r.id === both.id)).toBe(false);
    expect(JSON.stringify(googleRows)).not.toMatch(/passwordHash|googleId/);

    await prisma.user.delete({ where: { id: both.id } });
  });
});
