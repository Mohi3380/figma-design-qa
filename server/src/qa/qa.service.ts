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
import { isProduction } from '../config/secrets.util';
import { RunInput } from './dto/run-qa.dto';

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
  ) {
    this.logger.setContext('QA');
  }

  /**
   * In-process jobs don't survive a restart, so any job left PENDING/RUNNING by
   * a previous process is orphaned — fail it on boot so it isn't stuck forever.
   */
  async onModuleInit(): Promise<void> {
    const { count } = await this.prisma.qAJob.updateMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'FAILED', error: 'Interrupted by a server restart.', finishedAt: new Date() },
    });
    if (count > 0) this.logger.warn({ count }, 'Marked orphaned QA jobs as failed on boot');
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
    void this.enqueue(userId, input, subject);
    return subject.asObservable();
  }

  private async enqueue(userId: string, input: RunInput, subject: Subject<MessageEvent>): Promise<void> {
    let jobId: string;
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
      jobId = job.id;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Failed to enqueue QA job');
      subject.next({ type: 'error', data: { message: 'Could not start the QA run.' } } as MessageEvent);
      subject.complete();
      return;
    }

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

  private async runJob(entry: QueueEntry): Promise<void> {
    const { jobId, userId, input, subject } = entry;
    const emit = (type: string, data: unknown) => {
      subject.next({ type, data } as MessageEvent);
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

      const tokenInfo = await this.credentials.getFigmaToken(userId);
      if (!tokenInfo) {
        throw new Error('No Figma access. Connect your own Figma account (OAuth or token) to run a QA.');
      }

      // Vision uses the user's OWN Anthropic key. If requested without a key,
      // run the deterministic layers and tell them why vision was skipped.
      const anthropicKey = (await this.credentials.getAnthropicKey(userId)) ?? undefined;
      const visionEnabled = input.vision && Boolean(anthropicKey);
      if (input.vision && !anthropicKey) {
        emit('log', {
          message: 'Vision adjudication skipped: add your Anthropic API key to enable Claude vision.',
        });
      }

      const config = await this.engine.loadConfig();
      const outDir = path.join(this.outputRoot(), jobId);
      await fs.mkdir(outDir, { recursive: true });

      const result = await this.withTimeout(
        this.engine.runPipeline({
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
        }),
        this.jobTimeoutMs(),
        'QA run timed out.',
      );

      const summary = result.report?.summary ?? {};
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
          summary: JSON.stringify(summary),
          htmlPath: result.htmlPath ?? null,
          jsonPath: result.jsonPath ?? null,
          pdfPath: result.pdfPath ?? null,
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
      subject.complete();
    }
  }

  /**
   * Race a promise against a wall-clock timeout. Note: the engine pipeline is
   * not directly cancellable, so on timeout the job is failed and its slot is
   * freed immediately; an orphaned pipeline closes its own browser shortly
   * after (Playwright has its own per-step timeouts). This bounds queue latency
   * even if a single run wedges.
   */
  private withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([
      p.finally(() => clearTimeout(timer)),
      timeout,
    ]) as Promise<T>;
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
      report: j.report
        ? {
            frameName: j.report.frameName,
            viewport: j.report.viewport,
            pointersChecked: j.report.pointersChecked,
            passed: j.report.passed,
            failed: j.report.failed,
            matched: j.report.matched,
            issuesBySeverity: safeJson(j.report.issuesBySeverity),
            hasPdf: Boolean(j.report.pdfPath),
          }
        : null,
    }));
  }

  async getJob(userId: string, id: string) {
    const job = await this.prisma.qAJob.findFirst({ where: { id, userId }, include: { report: true } });
    if (!job) throw new NotFoundException('QA job not found.');
    return job;
  }

  /** Resolve a report file (html/pdf) for a user-owned job. */
  async getReportFile(userId: string, id: string, kind: 'html' | 'pdf'): Promise<string> {
    const job = await this.getJob(userId, id);
    const p = kind === 'pdf' ? job.report?.pdfPath : job.report?.htmlPath;
    if (!p) throw new NotFoundException(`No ${kind} report for this job.`);
    return p;
  }
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

function safeJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
