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
import { QaService } from './qa.service';
import { RunQaDto } from './dto/run-qa.dto';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('qa')
@UseGuards(JwtAuthGuard)
export class QaController {
  constructor(private readonly qa: QaService) {}

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
    const file = await this.qa.getReportFile(user.id, id, 'html');
    res.sendFile(file);
  }

  @Get('jobs/:id/report.pdf')
  async reportPdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const file = await this.qa.getReportFile(user.id, id, 'pdf');
    res.sendFile(file);
  }
}
