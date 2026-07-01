/**
 * Standalone QA worker process (distributed mode).
 *
 * Run alongside the API once you scale past one instance:
 *     REDIS_URL=... QA_INLINE_WORKER=false node dist/worker.main.js
 *
 * It boots a headless Nest application context (no HTTP server), consumes QA
 * jobs from the BullMQ queue, and runs the SAME pipeline the API would — so
 * Playwright + outbound traffic live here, off the API process. Progress is
 * published back to each job's Redis channel for the API instance holding the
 * SSE connection. With REDIS_URL unset this exits immediately (nothing to do).
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { QaService } from './qa/qa.service';
import { QaQueueService } from './qa/qa-queue.service';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });

  const queue = app.get(QaQueueService);
  if (!queue.enabled()) {
    logger.error('REDIS_URL is not set — the worker has no queue to consume. Exiting.');
    await app.close();
    process.exit(1);
  }

  const qa = app.get(QaService);
  const config = app.get(ConfigService);
  const concurrency = Math.max(1, Number(config.get('QA_MAX_CONCURRENT') ?? 2));

  const worker = await queue.createWorker((job) => qa.processQueuedJob(job.data), concurrency);
  logger.log(`QA worker online (concurrency ${concurrency}). Waiting for jobs…`);

  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — draining worker…`);
    try {
      await worker.close();
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
