import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Observable, Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { EngineService } from '../engine/engine.service';
import { FigmaService } from '../figma/figma.service';
import { RunInput } from './dto/run-qa.dto';

@Injectable()
export class QaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly figma: FigmaService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('QA');
  }

  private outputRoot(): string {
    return this.config.get<string>('QA_OUTPUT_DIR') ?? path.resolve(process.cwd(), 'qa-output');
  }

  /** Run a QA job for a user, streaming progress as SSE. */
  run(userId: string, input: RunInput): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    void this.execute(userId, input, subject);
    return subject.asObservable();
  }

  private async execute(userId: string, input: RunInput, subject: Subject<MessageEvent>): Promise<void> {
    const emit = (type: string, data: unknown) => subject.next({ type, data } as MessageEvent);
    let jobId: string | undefined;
    try {
      const job = await this.prisma.qAJob.create({
        data: {
          userId,
          figmaUrl: input.figma,
          targetUrl: input.target,
          vision: input.vision,
          pdf: input.pdf,
          viewport: input.viewport ?? null,
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });
      jobId = job.id;

      const tokenInfo = await this.figma.getUsableToken(userId);
      if (!tokenInfo) {
        throw new Error('No Figma access. Connect your Figma account to run a QA.');
      }

      const config = await this.engine.loadConfig();
      const outDir = path.join(this.outputRoot(), job.id);
      await fs.mkdir(outDir, { recursive: true });

      const result = await this.engine.runPipeline({
        figmaUrl: input.figma,
        target: input.target,
        viewport: input.viewport,
        config,
        outDir,
        vision: input.vision,
        pdf: input.pdf,
        figmaToken: tokenInfo.token,
        figmaTokenScheme: tokenInfo.scheme,
        anthropicKey: this.config.get<string>('ANTHROPIC_API_KEY'),
        log: (message: string) => emit('log', { message }),
      });

      const summary = result.report?.summary ?? {};
      await this.prisma.qAReport.create({
        data: {
          jobId: job.id,
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
        where: { id: job.id },
        data: { status: 'COMPLETED', finishedAt: new Date() },
      });

      emit('done', {
        jobId: job.id,
        summary,
        matching: result.report?.matching ?? { matched: 0 },
        viewport: result.viewport,
        frameName: result.report?.design?.frameName,
        hasPdf: Boolean(result.pdfPath),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message, jobId }, 'QA job failed');
      if (jobId) {
        await this.prisma.qAJob
          .update({ where: { id: jobId }, data: { status: 'FAILED', error: message, finishedAt: new Date() } })
          .catch(() => undefined);
      }
      emit('error', { message, jobId });
    } finally {
      subject.complete();
    }
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

function safeJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
