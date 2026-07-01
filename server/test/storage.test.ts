/**
 * Storage abstraction (local backend). Proves the seam that lets avatars + QA
 * report artifacts move to S3 without touching callers:
 *  - putBuffer / serve round-trips through a key
 *  - putFromPath is a no-op when the source already sits at the key's location
 *    (the common local case — the engine wrote it there during the run)
 *  - serve throws NotFound for a missing key
 *  - legacy absolute-path keys still serve (back-compat)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalStorage } from '../src/storage/local-storage.service';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-storage-'));
const storage = new LocalStorage(new ConfigService({ STORAGE_LOCAL_ROOT: root }));

// Minimal Response stand-in capturing what serve() does.
function fakeRes() {
  return {
    sent: undefined as string | undefined,
    redirected: undefined as string | undefined,
    sendFile(p: string) {
      this.sent = p;
    },
    redirect(u: string) {
      this.redirected = u;
    },
  };
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('LocalStorage', () => {
  it('stores a buffer and serves it back by key', async () => {
    await storage.putBuffer('avatars/abc.png', Buffer.from('img'), 'image/png');
    expect(fs.existsSync(path.join(root, 'avatars/abc.png'))).toBe(true);
    const res = fakeRes();
    await storage.serve(res as any, 'avatars/abc.png');
    expect(res.sent).toBe(path.join(root, 'avatars/abc.png'));
  });

  it('putFromPath is a no-op when the file already sits at the key location', async () => {
    const inPlace = path.join(root, 'job1', 'report.html');
    fs.mkdirSync(path.dirname(inPlace), { recursive: true });
    fs.writeFileSync(inPlace, '<html>');
    await storage.putFromPath('job1/report.html', inPlace, 'text/html'); // must not throw / corrupt
    expect(fs.readFileSync(inPlace, 'utf8')).toBe('<html>');
  });

  it('copies when the source is elsewhere', async () => {
    const src = path.join(os.tmpdir(), `src-${process.pid}.pdf`);
    fs.writeFileSync(src, 'pdf-bytes');
    await storage.putFromPath('job2/report.pdf', src, 'application/pdf');
    expect(fs.readFileSync(path.join(root, 'job2/report.pdf'), 'utf8')).toBe('pdf-bytes');
    fs.rmSync(src);
  });

  it('throws NotFound for a missing key', async () => {
    await expect(storage.serve(fakeRes() as any, 'avatars/missing.png')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('serves a legacy absolute path directly', async () => {
    const legacy = path.join(root, 'legacy-report.html');
    fs.writeFileSync(legacy, 'x');
    const res = fakeRes();
    await storage.serve(res as any, legacy);
    expect(res.sent).toBe(legacy);
  });
});
