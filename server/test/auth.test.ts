/**
 * Auth hardening from the code review:
 *  - Refresh-token rotation is strictly single-use (the same token can't be
 *    rotated twice — the concurrency race that minted two live families is gone).
 *  - rotateRefresh refuses a token that isn't typed as a refresh token.
 *  - forgot-password is a silent no-op for Google-only (no-password) accounts,
 *    so a reset can't create a local password on an SSO-only identity.
 *  - JwtAuthGuard rejects a disabled user even with an otherwise-valid token.
 *
 * Runs the REAL services against a throwaway SQLite database.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverRoot = path.resolve(__dirname, '..');
const dbFile = path.join(os.tmpdir(), `qa-auth-${process.pid}-${Date.now()}.db`);

process.env.DATABASE_URL = `file:${dbFile}`;
process.env.TOKEN_ENC_SECRET = 'test-token-encryption-secret-0123456789';

import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

const prisma = new PrismaService();
const config = new ConfigService();
const users = new UsersService(prisma);
const jwt = new JwtService({});
const mailStub = { sendVerificationEmail: async () => {}, sendPasswordResetEmail: async () => {} } as any;
const auth = new AuthService(prisma, users, jwt, mailStub, config);
const guard = new JwtAuthGuard(jwt, config, prisma);

const reqCtx = (token: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ cookies: { access_token: token }, headers: {} }) }),
  }) as unknown as ExecutionContext;

beforeAll(async () => {
  execSync('npx prisma migrate deploy', { cwd: serverRoot, env: { ...process.env }, stdio: 'pipe' });
  await prisma.$connect();
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

describe('refresh-token rotation', () => {
  it('rotates a refresh token exactly once (single-use)', async () => {
    const user = await users.create({ email: 'rot@test.local' });
    const { refreshToken } = await auth.issueTokens(user);

    const rotated = await auth.rotateRefresh(refreshToken);
    expect(rotated.user.id).toBe(user.id);
    expect(rotated.refreshToken).not.toBe(refreshToken);

    // The original token must not be usable a second time.
    await expect(auth.rotateRefresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not mint two families when the same token is rotated concurrently', async () => {
    const user = await users.create({ email: 'race@test.local' });
    const { refreshToken } = await auth.issueTokens(user);

    const results = await Promise.allSettled([
      auth.rotateRefresh(refreshToken),
      auth.rotateRefresh(refreshToken),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1); // exactly one winner
  });

  it('rejects a token that is not typed as a refresh token', async () => {
    const user = await users.create({ email: 'type@test.local' });
    // Signed with the refresh secret but the wrong type — must be refused.
    const bogus = await jwt.signAsync({ sub: user.id, type: 'access' }, { secret: 'dev-refresh-secret' });
    await expect(auth.rotateRefresh(bogus)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('forgot-password', () => {
  it('is a no-op for a Google-only account (no password to reset)', async () => {
    const u = await users.create({ email: 'google-only@test.local', googleId: 'g-123', emailVerified: true });
    await auth.forgotPassword(u.email);
    const tokens = await prisma.verificationToken.count({ where: { userId: u.id, type: 'PASSWORD_RESET' } });
    expect(tokens).toBe(0);
  });

  it('issues a reset token for a password account', async () => {
    const u = await users.create({ email: 'has-pw@test.local', passwordHash: 'x' });
    await auth.forgotPassword(u.email);
    const tokens = await prisma.verificationToken.count({ where: { userId: u.id, type: 'PASSWORD_RESET' } });
    expect(tokens).toBe(1);
  });
});

describe('JwtAuthGuard account-state enforcement', () => {
  it('admits a valid token for an active user', async () => {
    const u = await users.create({ email: 'active@test.local' });
    const { accessToken } = await auth.issueTokens(u);
    await expect(guard.canActivate(reqCtx(accessToken))).resolves.toBe(true);
  });

  it('rejects a still-valid token once the account is disabled', async () => {
    const u = await users.create({ email: 'disabled@test.local' });
    const { accessToken } = await auth.issueTokens(u);
    await prisma.user.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    await expect(guard.canActivate(reqCtx(accessToken))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
