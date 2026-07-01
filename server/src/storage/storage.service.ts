import type { Response } from 'express';

/**
 * Storage seam for user-facing binary artifacts (avatar images, QA report
 * html/pdf). One interface, two backends:
 *   - LocalStorage  — the instance's filesystem (single-instance / dev default)
 *   - S3Storage     — object storage (required once you run >1 instance, since
 *                     local disk isn't shared and the box serving a download
 *                     may not be the one that produced it)
 *
 * Keys are backend-agnostic relative paths, e.g. `avatars/<rand>.png` or
 * `<jobId>/report.html`. Callers never branch on the backend.
 */
export abstract class StorageService {
  /** Persist a file that already exists on local disk (e.g. an engine-produced
   * report artifact) under `key`. */
  abstract putFromPath(key: string, localPath: string, contentType: string): Promise<void>;

  /** Persist an in-memory buffer (e.g. an uploaded avatar) under `key`. */
  abstract putBuffer(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Write the stored object to the response (sendFile locally, presigned
   * redirect on S3). Throws NotFoundException when the object is missing. */
  abstract serve(res: Response, key: string): Promise<void>;
}
