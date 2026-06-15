import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import type { Request } from 'express';

/** Catches everything, returns a consistent JSON error shape, and logs it. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('Exceptions');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: unknown = 'Internal server error';
    let error = 'InternalServerError';
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as Record<string, unknown>).message ?? res;
      error = exception.name;
    } else if (exception instanceof Error) {
      error = exception.name;
    }

    if (status >= 500) {
      this.logger.error({ err: exception, path: req?.url }, 'Unhandled exception');
    } else {
      this.logger.warn({ path: req?.url, status }, String(message));
    }

    const body = {
      statusCode: status,
      error,
      message,
      path: req?.url,
      timestamp: new Date().toISOString(),
    };
    httpAdapter.reply(ctx.getResponse(), body, status);
  }
}
