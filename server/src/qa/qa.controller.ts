import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { Throttle } from '@nestjs/throttler';
import { QaService } from './qa.service';
import { RunQaDto } from './dto/run-qa.dto';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StorageService } from '../storage/storage.service';

@Controller('qa')
@UseGuards(JwtAuthGuard)
export class QaController {
  constructor(
    private readonly qa: QaService,
    private readonly storage: StorageService,
  ) {}

  // A QA run launches a headless browser and makes outbound requests, so it's
  // expensive and an SSRF-amplification vector — keep it tightly throttled
  // (well below the global default). (Security review: rate-limit finding.)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Sse('run')
  run(@Query() dto: RunQaDto, @CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.qa.run(user.id, {
      figma: dto.figma,
      target: dto.target,
      vision: dto.vision !== 'false',
      pdf: dto.pdf !== 'false',
      viewport: dto.viewport ? Number(dto.viewport) : undefined,
    });
  }

  @Get('jobs')
  listJobs(@CurrentUser() user: AuthUser) {
    return this.qa.listJobs(user.id);
  }

  @Get('jobs/:id')
  getJob(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.qa.getJob(user.id, id);
  }

  @Get('jobs/:id/report.html')
  async reportHtml(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const key = await this.qa.getReportFile(user.id, id, 'html');
    await this.storage.serve(res, key);
  }

  @Get('jobs/:id/report.pdf')
  async reportPdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const key = await this.qa.getReportFile(user.id, id, 'pdf');
    await this.storage.serve(res, key);
  }
}
