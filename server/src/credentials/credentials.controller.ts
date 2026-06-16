import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SetAnthropicKeyDto, SetFigmaPatDto } from './dto/credentials.dto';

/**
 * Per-user credential management. Every route is scoped to the authenticated
 * user; secrets are write-only here — they are never returned by any endpoint.
 */
@Controller('credentials')
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.credentials.status(user.id);
  }

  @Post('figma/pat')
  @HttpCode(200)
  async setFigmaPat(@CurrentUser() user: AuthUser, @Body() dto: SetFigmaPatDto) {
    const { account } = await this.credentials.setFigmaPat(user.id, dto.token);
    return { ok: true, account };
  }

  @Delete('figma')
  @HttpCode(200)
  async disconnectFigma(@CurrentUser() user: AuthUser) {
    await this.credentials.disconnect(user.id, 'figma');
    return { ok: true };
  }

  @Post('anthropic')
  @HttpCode(200)
  async setAnthropic(@CurrentUser() user: AuthUser, @Body() dto: SetAnthropicKeyDto) {
    await this.credentials.setAnthropicKey(user.id, dto.key);
    return { ok: true };
  }

  @Delete('anthropic')
  @HttpCode(200)
  async disconnectAnthropic(@CurrentUser() user: AuthUser) {
    await this.credentials.disconnect(user.id, 'anthropic');
    return { ok: true };
  }
}
