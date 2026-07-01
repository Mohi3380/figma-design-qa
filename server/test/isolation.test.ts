/**
 * Cross-user isolation (the NON-NEGOTIABLE security property of the QA engine):
 *
 *  - A user's Figma/Anthropic credential is NEVER used for another user's run,
 *    and there is NO global/shared fallback token.
 *  - A user cannot read, list, or download another user's jobs or reports (IDOR).
 *  - Stored secrets are write-only — never echoed back by the status endpoint.
 *
 * This runs the REAL services (CredentialsService, QaService) against a throwaway
 * SQLite database, so it proves the queries actually scope by owner — not just
 * that the code looks right.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverRoot = path.resolve(__dirname, '..');
const dbFile = path.join(os.tmpdir(), `qa-iso-${process.pid}-${Date.now()}.db`);
const ENC_SECRET = 'test-token-encryption-secret-0123456789';

// Set BEFORE PrismaClient is instantiated (it reads DATABASE_URL at connect).
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.TOKEN_ENC_SECRET = ENC_SECRET;
// Deliberately set "global" credentials to prove they are NOT used as a fallback.
process.env.FIGMA_TOKEN = 'figd_GLOBAL_must_never_be_used';
process.env.ANTHROPIC_API_KEY = 'sk-ant-GLOBAL_must_never_be_used';

import { PrismaService } from '../src/prisma/prisma.service';
import { CredentialsService } from '../src/credentials/credentials.service';
import { QaService } from '../src/qa/qa.service';
import { encryptSecret } from '../src/common/crypto.util';

const config = new ConfigService();
const prisma = new PrismaService();
const credentials = new CredentialsService(prisma, config);
const loggerStub = { setContext() {}, warn() {}, info() {}, error() {}, debug() {} } as any;
const engineStub = { loadConfig: async () => ({}), runPipeline: async () => ({}) } as any;
const storageStub = { putFromPath: async () => {}, putBuffer: async () => {}, serve: async () => {} } as any;
const queueStub = { enabled: () => false } as any; // in-process mode for tests
const qa = new QaService(prisma, engineStub, credentials, config, loggerStub, storageStub, queueStub);

let userA: { id: string };
let userB: { id: string };
let jobA: { id: string };

beforeAll(async () => {
  // Provision the schema in the throwaway DB.
  execSync('npx prisma migrate deploy', {
    cwd: serverRoot,
    env: { ...process.env },
    stdio: 'pipe',
  });
  await prisma.$connect();

  userA = await prisma.user.create({ data: { email: 'alice@test.local', name: 'Alice' } });
  userB = await prisma.user.create({ data: { email: 'bob@test.local', name: 'Bob' } });

  // Alice has both a Figma token and an Anthropic key. Bob has neither.
  await prisma.apiCredential.create({
    data: {
      userId: userA.id,
      provider: 'figma',
      type: 'pat',
      secretEnc: encryptSecret('figd_ALICE_secret', ENC_SECRET),
      accountLabel: 'alice-figma',
    },
  });
  await prisma.apiCredential.create({
    data: {
      userId: userA.id,
      provider: 'anthropic',
      type: 'pat',
      secretEnc: encryptSecret('sk-ant-ALICE_key', ENC_SECRET),
      accountLabel: 'Anthropic key',
    },
  });

  jobA = await prisma.qAJob.create({
    data: {
      userId: userA.id,
      figmaUrl: 'https://figma.com/design/K/F?node-id=1-2',
      targetUrl: 'https://example.com',
      status: 'COMPLETED',
    },
  });
  await prisma.qAReport.create({
    data: { jobId: jobA.id, htmlPath: '/tmp/a/report.html', pdfPath: '/tmp/a/report.pdf' },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(dbFile + suffix);
    } catch {
      /* ignore */
    }
  }
});

describe('credential isolation', () => {
  it('resolves a user to their OWN Figma token', async () => {
    const tok = await credentials.getFigmaToken(userA.id);
    expect(tok).toEqual({ token: 'figd_ALICE_secret', scheme: 'pat' });
  });

  it('returns null for a user with no credential — and never the global FIGMA_TOKEN', async () => {
    const tok = await credentials.getFigmaToken(userB.id);
    expect(tok).toBeNull();
    // Prove the env "global" token is truly inert.
    expect(tok?.token).not.toBe(process.env.FIGMA_TOKEN);
  });

  it('never resolves one user to another user\'s Anthropic key, nor the global one', async () => {
    expect(await credentials.getAnthropicKey(userA.id)).toBe('sk-ant-ALICE_key');
    const bobKey = await credentials.getAnthropicKey(userB.id);
    expect(bobKey).toBeNull();
    expect(bobKey).not.toBe(process.env.ANTHROPIC_API_KEY);
  });

  it('status() is write-only — it never returns the stored secret', async () => {
    const status = await credentials.status(userA.id);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('figd_ALICE_secret');
    expect(serialized).not.toContain('sk-ant-ALICE_key');
    expect(status.figma.connected).toBe(true);
    expect(status.anthropic.connected).toBe(true);
  });
});

describe('job/report IDOR protection', () => {
  it('lets the owner read their own job', async () => {
    const job = await qa.getJob(userA.id, jobA.id);
    expect(job.id).toBe(jobA.id);
  });

  it('does NOT let another user read the job', async () => {
    await expect(qa.getJob(userB.id, jobA.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does NOT let another user download the report file', async () => {
    await expect(qa.getReportFile(userB.id, jobA.id, 'html')).rejects.toBeInstanceOf(NotFoundException);
    await expect(qa.getReportFile(userB.id, jobA.id, 'pdf')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes job listings to the requesting user', async () => {
    expect(await qa.listJobs(userA.id)).toHaveLength(1);
    expect(await qa.listJobs(userB.id)).toHaveLength(0);
  });
});
