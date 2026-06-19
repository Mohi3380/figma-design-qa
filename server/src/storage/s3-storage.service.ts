import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fs from 'node:fs/promises';
import type { Response } from 'express';
import type { S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

/**
 * S3 (or any S3-compatible store, e.g. MinIO/R2 via S3_ENDPOINT) backend.
 *
 * The AWS SDK is imported lazily so it is never loaded in the default
 * local-disk deployment. Downloads are served as short-lived presigned
 * redirects rather than proxied through the API, so large PDFs don't tie up
 * the event loop.
 *
 * Env: S3_BUCKET (required), S3_REGION, S3_ENDPOINT (optional, for S3-compat),
 * S3_PREFIX (optional key namespace), S3_URL_TTL (presign seconds, default 300).
 * Credentials come from the standard AWS provider chain (env / role / profile).
 */
export class S3Storage extends StorageService {
  private readonly bucket: string;
  private readonly region: string;
  private readonly endpoint?: string;
  private readonly prefix: string;
  private readonly ttl: number;
  private clientPromise: Promise<S3Client> | null = null;

  constructor(config: ConfigService) {
    super();
    const bucket = config.get<string>('S3_BUCKET');
    if (!bucket) throw new InternalServerErrorException('STORAGE_DRIVER=s3 requires S3_BUCKET.');
    this.bucket = bucket;
    this.region = config.get<string>('S3_REGION') ?? 'us-east-1';
    this.endpoint = config.get<string>('S3_ENDPOINT') || undefined;
    this.prefix = (config.get<string>('S3_PREFIX') ?? '').replace(/^\/+|\/+$/g, '');
    this.ttl = Number(config.get('S3_URL_TTL') ?? 300);
  }

  private fullKey(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  private async client(): Promise<S3Client> {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-s3').then(
        ({ S3Client }) =>
          new S3Client({
            region: this.region,
            ...(this.endpoint ? { endpoint: this.endpoint, forcePathStyle: true } : {}),
          }),
      );
    }
    return this.clientPromise;
  }

  async putFromPath(key: string, localPath: string, contentType: string): Promise<void> {
    await this.putBuffer(key, await fs.readFile(localPath), contentType);
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key), Body: body, ContentType: contentType }),
    );
  }

  async serve(res: Response, key: string): Promise<void> {
    const [{ GetObjectCommand, HeadObjectCommand }, { getSignedUrl }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    const client = await this.client();
    const Key = this.fullKey(key);
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
    } catch {
      throw new NotFoundException();
    }
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key }), {
      expiresIn: this.ttl,
    });
    res.redirect(url);
  }
}
