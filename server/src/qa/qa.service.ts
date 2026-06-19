import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Observable, Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';
import { CredentialsService } from '../credentials/credentials.service';
import { StorageService } from '../storage/storage.service';
import { isProduction } from '../config/secrets.util';
import { parseSeverity } from '../common/stats.util';
import { RunInput } from './dto/run-qa.dto';
import { QaQueueService } from './qa-queue.service';

/** A queued run: the job row, its owner, inputs, and its live SSE channel. */
interface QueueEntry {
  jobId: string;
  userId: string;
  input: RunInput;
  subject: Subject<MessageEvent>;
}

@Injectable()
export class QaService implements OnModuleInit {
  // ---- in-process worker state -----------------------------------------
  // QA runs are heavy (a headless browser + outbound fetches + optional vision),
  // so we don't run them all at once. Jobs are queued and a small scheduler
  // drains them under a global cap AND a per-user cap, so one user can never
  // starve others or fan out a burst of expensive runs.
  private readonly queue: QueueEntry[] = [];
  private runningGlobal = 0;
  private readonly runningByUser = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly credentials: CredentialsService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    private readonly storage: StorageService,
    private readonly queueTransport: QaQueueService,
  ) {
    this.logger.setContext('QA');
  }

  async onModuleInit(): Promise<void> {
    if (this.queueTransport.enabled()) {
      // Distributed mode: jobs live in Redis and run on (possibly separate)
      // worker processes, so an API restart must NOT fail in-flight jobs.
      // Optionally run a worker inside this process for single-box setups
      // (set QA_INLINE_WORKER=false when you deploy dedicated worker processes).
      if (this.config.get<string>('QA_INLINE_WORKER') !== 'false') {
        await this.startInlineWorker();
      }
      return;
    }
    // In-process mode: jobs don't survive a restart, so any job left
    // PENDING/RUNNING by a previous process is orphaned — fail it on boot.
    const { count } = await this.prisma.qAJob.updateMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'FAILED', error: 'Interrupted by a server restart.', finishedAt: new Date() },
    });
    if (count > 0) this.logger.warn({ count }, 'Marked orphaned QA jobs as failed on boot');
  }

  /** Run a BullMQ worker in THIS process (single-box distributed setups). */
  private async startInlineWorker(): Promise<void> {
    await this.queueTransport.createWorker((job) => this.processQueuedJob(job.data), this.maxGlobal());
    this.logger.info({ concurrency: this.maxGlobal() }, 'Inline QA worker started');
  }

  /** Process a job pulled from the distributed queue: run it and publish every
   * progress event to the job's Redis channel (in order). Shared by the inline
   * worker and the standalone worker entrypoint (worker.main.ts). */
  async processQueuedJob(data: { jobId: string; userId: string; input: RunInput }): Promise<void> {
    let chain: Promise<void> = Promise.resolve();
    await this.executeJob(data.jobId, data.userId, data.input, (type, payload) => {
      // Serialize publishes so events arrive in emit order.
      chain = chain.then(() => this.queueTransport.publish(data.jobId, { type, data: payload }));
    });
    await chain;
  }

  private outputRoot(): string {
    return this.config.get<string>('QA_OUTPUT_DIR') ?? path.resolve(process.cwd(), 'qa-output');
  }

  private maxPerUser(): number {
    return Math.max(1, Number(this.config.get('QA_MAX_CONCURRENT_PER_USER') ?? 1));
  }
  private maxGlobal(): number {
    return Math.max(1, Number(this.config.get('QA_MAX_CONCURRENT') ?? 2));
  }
  private jobTimeoutMs(): number {
    return Math.max(30_000, Number(this.config.get('QA_JOB_TIMEOUT_MS') ?? 300_000));
  }

  /**
   * Whether SSRF targets may resolve to private/loopback addresses. Controlled
   * by `ALLOW_LOCAL_TARGETS` (legacy alias: `QA_ALLOW_PRIVATE_TARGETS`) and
   * HARD-disabled in production regardless of the flag.
   */
  private allowPrivateTargets(): boolean {
    if (isProduction()) return false;
    const flag =
      this.config.get<string>('ALLOW_LOCAL_TARGETS') ??
      this.config.get<string>('QA_ALLOW_PRIVATE_TARGETS');
    return flag === 'true';
  }

  /** Enqueue a QA job for a user and return its live progress stream. */
  run(userId: string, input: RunInput): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    void this.dispatch(userId, input, subject);
    return subject.asObservable();
  }

  /** Create the job row (shared by both modes); emits+completes on failure. */
  private async createJobRow(
    userId: string,
    input: RunInput,
    subject: Subject<MessageEvent>,
  ): Promise<string | null> {
    try {
      const job = await this.prisma.qAJob.create({
        data: {
          userId,
          figmaUrl: input.figma,
          targetUrl: input.target,
          vision: input.vision,
          pdf: input.pdf,
          viewport: input.viewport ?? null,
          status: 'PENDING',
        },
      });
      return job.id;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Failed to enqueue QA job');
      subject.next({ type: 'error', data: { message: 'Could not start the QA run.' } } as MessageEvent);
      subject.complete();
      return null;
    }
  }

  private async dispatch(userId: string, input: RunInput, subject: Subject<MessageEvent>): Promise<void> {
    const jobId = await this.createJobRow(userId, input, subject);
    if (!jobId) return;

    if (this.queueTransport.enabled()) {
      // Distributed: the run may execute on another instance/worker. Subscribe
      // to the job's Redis channel and relay events to this SSE client.
      let unsub: () => Promise<void> = async () => {};
      try {
        unsub = await this.queueTransport.subscribe(jobId, (event) => {
          subject.next({ type: event.type, data: event.data } as MessageEvent);
          if (event.type === 'done' || event.type === 'error') {
            subject.complete();
            void unsub();
          }
        });
        subject.next({ type: 'log', data: { message: 'Queued…', jobId } } as MessageEvent);
        await this.queueTransport.add({ jobId, userId, input });
      } catch (err) {
        this.logger.warn({ err: String(err), jobId }, 'Failed to enqueue QA job to Redis');
        subject.next({ type: 'error', data: { message: 'Could not start the QA run.', jobId } } as MessageEvent);
        subject.complete();
        void unsub();
      }
      return;
    }

    // In-process: run on this instance under the global + per-user caps.
    const entry: QueueEntry = { jobId, userId, input, subject };
    this.queue.push(entry);
    const ahead = this.queue.length - 1 + this.runningGlobal;
    subject.next({
      type: 'log',
      data: { message: ahead > 0 ? `Queued (${ahead} ahead)…` : 'Queued…', jobId },
    } as MessageEvent);
    this.pump();
  }

  /** Drain the queue while there's global capacity and an eligible (under per-user cap) job. */
  private pump(): void {
    while (this.runningGlobal < this.maxGlobal()) {
      const perUser = this.maxPerUser();
      const idx = this.queue.findIndex((e) => (this.runningByUser.get(e.userId) ?? 0) < perUser);
      if (idx === -1) break; // nothing eligible right now
      const entry = this.queue.splice(idx, 1)[0];
      this.runningGlobal++;
      this.runningByUser.set(entry.userId, (this.runningByUser.get(entry.userId) ?? 0) + 1);
      void this.runJob(entry).finally(() => {
        this.runningGlobal--;
        this.runningByUser.set(entry.userId, Math.max(0, (this.runningByUser.get(entry.userId) ?? 1) - 1));
        this.pump();
      });
    }
  }

  /** In-process worker entry: run the job, streaming events to its Subject. */
  private async runJob(entry: QueueEntry): Promise<void> {
    try {
      await this.executeJob(entry.jobId, entry.userId, entry.input, (type, data) =>
        entry.subject.next({ type, data } as MessageEvent),
      );
    } finally {
      entry.subject.complete();
    }
  }

  /**
   * Run a single QA job end-to-end, streaming progress to `sink`. Mode-agnostic:
   * the in-process path passes a Subject sink; the distributed worker passes a
   * Redis-publish sink. Never throws (failures are reported via the sink).
   */
  async executeJob(
    jobId: string,
    userId: string,
    input: RunInput,
    sink: (type: string, data: unknown) => void,
  ): Promise<void> {
    const emit = (type: string, data: unknown) => {
      sink(type, data);
      // Persist the latest stage so listJobs/getJob reflect progress even if the
      // SSE client disconnects. Fire-and-forget; log lines are infrequent stages.
      if (type === 'log') {
        const message = (data as { message?: string })?.message;
        if (message) {
          void this.prisma.qAJob
            .update({ where: { id: jobId }, data: { progress: message.slice(0, 500) } })
            .catch(() => undefined);
        }
      }
    };

    // The engine pipeline is not directly cancellable. Hold a reference so that
    // on timeout we can keep the concurrency slot reserved until it truly stops.
    let pipelinePromise: Promise<{ report?: any; htmlPath?: string; jsonPath?: string; pdfPath?: string; viewport?: number }> | null = null;

    try {
      // Mark RUNNING and re-read the row so the ownership check below is against
      // the persisted job, not the value we passed in.
      const job = await this.prisma.qAJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date(), error: null },
      });

      // Fail-closed owner assertion: a job may only ever be run with the
      // credentials of the user who owns it.
      if (job.userId !== userId) {
        throw new Error('Job ownership assertion failed.');
      }

      emit('log', { message: 'Starting QA run…', jobId });

      // Both credential reads are independent and owner-scoped — fetch them
      // concurrently rather than serializing two DB round-trips + decryptions.
      const [tokenInfo, anthropicKeyRaw] = await Promise.all([
        this.credentials.getFigmaToken(userId),
        this.credentials.getAnthropicKey(userId),
      ]);
      if (!tokenInfo) {
        throw new Error('No Figma access. Connect your own Figma account (OAuth or token) to run a QA.');
      }

      // Vision uses the user's OWN Anthropic key. If requested without a key,
      // run the deterministic layers and tell them why vision was skipped.
      const anthropicKey = anthropicKeyRaw ?? undefined;
      const visionEnabled = input.vision && Boolean(anthropicKey);
      if (input.vision && !anthropicKey) {
        emit('log', {
          message: 'Vision adjudication skipped: add your Anthropic API key to enable Claude vision.',
        });
      }

      const config = await this.engine.loadConfig();
      const outDir = path.join(this.outputRoot(), jobId);
      await fs.mkdir(outDir, { recursive: true });

      // Hoisted so the `finally` can keep this concurrency slot reserved until
      // the (non-cancellable) pipeline actually settles after a timeout.
      pipelinePromise = this.engine.runPipeline({
        figmaUrl: input.figma,
        target: input.target,
        viewport: input.viewport,
        config,
        outDir,
        vision: visionEnabled,
        pdf: input.pdf,
        figmaToken: tokenInfo.token,
        figmaTokenScheme: tokenInfo.scheme,
        anthropicKey,
        allowPrivateTargets: this.allowPrivateTargets(),
        log: (message: string) => emit('log', { message }),
      });
      const result = await this.withTimeout(pipelinePromise, this.jobTimeoutMs(), 'QA run timed out.');

      // Persist report artifacts through the storage layer (local disk by
      // default, S3 when configured) and store the backend-agnostic KEY, so a
      // different instance can serve the download in a multi-instance deploy.
      const root = this.outputRoot();
      const toKey = (abs: string) => path.relative(root, abs);
      let htmlKey: string | null = null;
      let pdfKey: string | null = null;
      if (result.htmlPath) {
        htmlKey = toKey(result.htmlPath);
        await this.storage.putFromPath(htmlKey, result.htmlPath, 'text/html');
      }
      if (result.pdfPath) {
        pdfKey = toKey(result.pdfPath);
        await this.storage.putFromPath(pdfKey, result.pdfPath, 'application/pdf');
      }

      const summary = result.report?.summary ?? {};
      const sev = parseSeverity(JSON.stringify(summary.issuesBySeverity ?? {}));
      await this.prisma.qAReport.create({
        data: {
          jobId,
          frameName: result.report?.design?.frameName ?? null,
          viewport: result.viewport ?? null,
          pointersChecked: summary.pointersChecked ?? 0,
          passed: summary.passed ?? 0,
          failed: summary.failed ?? 0,
          matched: result.report?.matching?.matched ?? 0,
          issuesBySeverity: JSON.stringify(summary.issuesBySeverity ?? {}),
          // Denormalized per-severity counts so dashboards can SUM() them
          // DB-side instead of loading + JSON-parsing every report row.
          sevCritical: sev.critical ?? 0,
          sevHigh: sev.high ?? 0,
          sevMedium: sev.medium ?? 0,
          sevLow: sev.low ?? 0,
          sevInfo: sev.info ?? 0,
          summary: JSON.stringify(summary),
          // Storage keys (relative), not absolute paths — resolved by StorageService.
          htmlPath: htmlKey,
          jsonPath: result.jsonPath ?? null,
          pdfPath: pdfKey,
        },
      });
      await this.prisma.qAJob.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', progress: 'Completed', finishedAt: new Date() },
      });

      emit('done', {
        jobId,
        summary,
        matching: result.report?.matching ?? { matched: 0 },
        viewport: result.viewport,
        frameName: result.report?.design?.frameName,
        hasPdf: Boolean(result.pdfPath),
      });
    } catch (err) {
      // Full detail (incl. stack) server-side only; client + stored job get a
      // sanitized one-liner (no filesystem paths / stack). (Security review.)
      this.logger.warn(
        { err: err instanceof Error ? (err.stack ?? err.message) : String(err), jobId },
        'QA job failed',
      );
      const safe = sanitizeError(err);
      await this.prisma.qAJob
        .update({ where: { id: jobId }, data: { status: 'FAILED', error: safe, finishedAt: new Date() } })
        .catch(() => undefined);
      emit('error', { message: safe, jobId });
    } finally {
      // The client has already been told the outcome above. If the pipeline is
      // still running (we timed out and abandoned the race), keep this slot
      // reserved until it actually settles so an orphaned browser can't push
      // real concurrency past maxGlobal — bounded so a wedged run can't pin the
      // slot forever.
      if (pipelinePromise) await settleWithin(pipelinePromise, this.jobTimeoutMs());
    }
  }

  /**
   * Race a promise against a wall-clock timeout. The engine pipeline is not
   * directly cancellable; on timeout this rejects (the caller frees the queue
   * after the orphan drains — see runJob's finally). `Promise.race` stays
   * subscribed to `p`, so a late rejection after the timeout won't surface as an
   * unhandled rejection.
   */
  private withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  async listJobs(userId: string) {
    const jobs = await this.prisma.qAJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { report: true },
    });
    return jobs.map((j) => ({
      id: j.id,
      figmaUrl: j.figmaUrl,
      targetUrl: j.targetUrl,
      status: j.status,
      progress: j.progress,
      error: j.error,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      report: j.report ? this.reportView(j.report) : null,
    }));
  }

  /** Client-safe projection of a report row: parsed severity, no filesystem
   * paths, no raw summary blob — the same shape listJobs exposes. */
  private reportView(r: {
    frameName: string | null;
    viewport: number | null;
    pointersChecked: number;
    passed: number;
    failed: number;
    matched: number;
    issuesBySeverity: string | null;
    pdfPath: string | null;
  }) {
    return {
      frameName: r.frameName,
      viewport: r.viewport,
      pointersChecked: r.pointersChecked,
      passed: r.passed,
      failed: r.failed,
      matched: r.matched,
      issuesBySeverity: parseSeverity(r.issuesBySeverity),
      hasPdf: Boolean(r.pdfPath),
    };
  }

  /** Internal: the owner-scoped raw job row (includes file paths). Never return
   * this straight to a client — use getJob for that. */
  private async getJobOwned(userId: string, id: string) {
    const job = await this.prisma.qAJob.findFirst({ where: { id, userId }, include: { report: true } });
    if (!job) throw new NotFoundException('QA job not found.');
    return job;
  }

  /** Client-facing single job: sanitized like listJobs (no internal fs paths,
   * severity parsed to an object) instead of the raw Prisma row. */
  async getJob(userId: string, id: string) {
    const j = await this.getJobOwned(userId, id);
    return {
      id: j.id,
      figmaUrl: j.figmaUrl,
      targetUrl: j.targetUrl,
      status: j.status,
      progress: j.progress,
      error: j.error,
      viewport: j.viewport,
      createdAt: j.createdAt,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      report: j.report ? this.reportView(j.report) : null,
    };
  }

  /** Resolve a report file (html/pdf) for a user-owned job. */
  async getReportFile(userId: string, id: string, kind: 'html' | 'pdf'): Promise<string> {
    const job = await this.getJobOwned(userId, id);
    const p = kind === 'pdf' ? job.report?.pdfPath : job.report?.htmlPath;
    if (!p) throw new NotFoundException(`No ${kind} report for this job.`);
    return p;
  }
}

/**
 * Await a promise but never longer than `capMs` — resolves once the promise
 * settles (success or failure) or the cap elapses, whichever comes first. The
 * timer is unref'd so it can't keep the event loop alive on its own.
 */
function settleWithin(p: Promise<unknown>, capMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, capMs);
    timer.unref?.();
    p.then(() => undefined, () => undefined).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Turn an arbitrary thrown error into a safe, user-facing one-liner: drop the
 * stack (first line only), strip absolute filesystem paths (Windows drives +
 * common unix roots), and cap length. Keeps useful gist (Figma API status,
 * "Could not load …", "No Figma access …") without leaking internals.
 */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let msg = raw.split('\n')[0].trim();
  msg = msg.replace(/[A-Za-z]:\\[^\s"'<>]+/g, '<path>'); // Windows absolute paths
  msg = msg.replace(/\/(?:home|users|var|etc|tmp|root|app|opt|usr)\/[^\s"'<>]*/gi, '<path>'); // common unix paths
  if (msg.length > 300) msg = msg.slice(0, 299) + '…';
  return msg || 'QA run failed.';
}
