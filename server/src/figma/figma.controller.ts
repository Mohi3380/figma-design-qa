import {
  Controller,
  Get,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { FigmaService } from './figma.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { cookieOptions } from '../auth/cookies';
import { randomToken } from '../common/crypto.util';

@Controller('figma')
@UseGuards(JwtAuthGuard)
export class FigmaController {
  constructor(
    private readonly figma: FigmaService,
    private readonly config: ConfigService,
  ) {}

  @Get('login')
  login(@Res() res: Response) {
    if (!this.figma.isConfigured()) {
      throw new ServiceUnavailableException('Figma connect is not configured.');
    }
    const state = randomToken(16);
    res.cookie('figma_oauth_state', state, cookieOptions(600));
    return res.redirect(this.figma.buildAuthorizeUrl(state));
  }

  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response, @CurrentUser() user: AuthUser) {
    const appUrl = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:4200';
    const code = (req.query.code as string) || '';
    const state = (req.query.state as string) || '';
    const expected = req.cookies?.['figma_oauth_state'];
    res.clearCookie('figma_oauth_state', { path: '/' });

    if (!code || !state || state !== expected) {
      return res.redirect(`${appUrl}/dashboard?figma=error`);
    }
    try {
      await this.figma.exchangeAndStore(user.id, code);
      return res.redirect(`${appUrl}/dashboard?figma=connected`);
    } catch {
      return res.redirect(`${appUrl}/dashboard?figma=error`);
    }
  }
}
