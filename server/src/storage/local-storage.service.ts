import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import { StorageService } from './storage.service';

/**
 * Filesystem-backed storage. Root defaults to the QA output dir so report
 * artifacts the engine already wrote there are stored in place (no copy).
 */
export class LocalStorage extends StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    super();
    this.root =
      config.get<string>('STORAGE_LOCAL_ROOT') ??
      config.get<string>('QA_OUTPUT_DIR') ??
      path.resolve(process.cwd(), 'qa-output');
  }

  private resolve(key: string): string {
    // Legacy rows stored absolute paths; serve those directly for back-compat.
    return path.isAbsolute(key) ? key : path.join(this.root, key);
  }

  async putFromPath(key: string, localPath: string, _contentType: string): Promise<void> {
    const dest = this.resolve(key);
    if (path.resolve(dest) === path.resolve(localPath)) return; // already in place
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(localPath, dest);
  }

  async putBuffer(key: string, body: Buffer, _contentType: string): Promise<void> {
    const dest = this.resolve(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
  }

  async serve(res: Response, key: string): Promise<void> {
    const p = this.resolve(key);
    if (!existsSync(p)) throw new NotFoundException();
    res.sendFile(p);
  }
}
