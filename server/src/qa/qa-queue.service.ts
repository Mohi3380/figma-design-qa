import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { URL } from 'node:url';
import type { ConnectionOptions, Processor, Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { RunInput } from './dto/run-qa.dto';

/** Payload of a queued QA run. */
export interface QaJobData {
  jobId: string;
  userId: string;
  input: RunInput;
}

/** A progress event relayed worker → API instance over Redis pub/sub. */
export interface QaEvent {
  type: string;
  data: unknown;
}

const QUEUE_NAME = 'qa-runs';
const channelFor = (jobId: string) => `qa:events:${jobId}`;

/**
 * Distributed transport for QA runs, active only when REDIS_URL is set.
 *
 *  - API instance: creates the job row, `add()`s a BullMQ job, and
 *    `subscribe()`s to the job's Redis channel to relay progress to its SSE
 *    client (the run may execute on a different instance/worker).
 *  - Worker: `createWorker()` consumes jobs and `publish()`es progress.
 *
 * bullmq + ioredis are imported lazily so they are never loaded in the default
 * in-process deployment (REDIS_URL unset). BullMQ builds its own connection
 * from parsed options (we never hand it our ioredis instance — bullmq bundles
 * its own ioredis copy, so a shared instance would fail its internal checks).
 */
@Injectable()
export class QaQueueService implements OnModuleDestroy {
  private readonly url?: string;
  private queue: Queue | null = null;
  private publisher: Redis | null = null;
  private readonly workers: Worker[] = [];

  constructor(private readonly config: ConfigService) {
    this.url = this.config.get<string>('REDIS_URL') || undefined;
  }

  /** Whether distributed mode is configured. */
  enabled(): boolean {
    return Boolean(this.url);
  }

  /** Connection options for BullMQ (it constructs its own ioredis from these). */
  private bullConnection(): ConnectionOptions {
    const u = new URL(this.url as string);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username || undefined,
      password: u.password || undefined,
      db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
      tls: u.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null, // required by BullMQ
    } as ConnectionOptions;
  }

  /** A standalone ioredis connection for our own pub/sub (not shared with BullMQ). */
  private async newRedis(): Promise<Redis> {
    const { default: IORedis } = await import('ioredis');
    return new IORedis(this.url as string, { maxRetriesPerRequest: null });
  }

  private async getQueue(): Promise<Queue> {
    if (!this.queue) {
      const { Queue } = await import('bullmq');
      this.queue = new Queue(QUEUE_NAME, { connection: this.bullConnection() });
    }
    return this.queue;
  }

  async add(data: QaJobData): Promise<void> {
    const queue = await this.getQueue();
    await queue.add('run', data, {
      attempts: 1, // QA runs aren't idempotent (browser + outbound calls) — don't retry
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Relay one job's events from Redis to `onEvent`. Returns an unsubscribe fn. */
  async subscribe(jobId: string, onEvent: (event: QaEvent) => void): Promise<() => Promise<void>> {
    const sub = await this.newRedis();
    const channel = channelFor(jobId);
    sub.on('message', (ch: string, payload: string) => {
      if (ch !== channel) return;
      try {
        onEvent(JSON.parse(payload) as QaEvent);
      } catch {
        /* ignore malformed event */
      }
    });
    await sub.subscribe(channel);
    return async () => {
      try {
        await sub.unsubscribe(channel);
      } finally {
        sub.disconnect();
      }
    };
  }

  /** Publish a job event (called by the worker). */
  async publish(jobId: string, event: QaEvent): Promise<void> {
    if (!this.publisher) this.publisher = await this.newRedis();
    await this.publisher.publish(channelFor(jobId), JSON.stringify(event));
  }

  /** Start a BullMQ worker bound to `processor`. Tracked for graceful shutdown. */
  async createWorker(processor: Processor, concurrency: number): Promise<Worker> {
    const { Worker } = await import('bullmq');
    const worker = new Worker(QUEUE_NAME, processor, { connection: this.bullConnection(), concurrency });
    this.workers.push(worker);
    return worker;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.queue?.close(), ...this.workers.map((w) => w.close())]);
    this.publisher?.disconnect();
  }
}
