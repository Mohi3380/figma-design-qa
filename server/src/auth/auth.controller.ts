import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard, AuthUser } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { GoogleOAuthGuard } from './google.strategy';
import { setAuthCookies, clearAuthCookies } from './cookies';
import { ForgotPasswordDto, LoginDto, ResetPasswordDto, SignupDto } from './dto/auth.dto';

const tight = { default: { limit: 8, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  private meta(req: Request) {
    return { userAgent: req.headers['user-agent'], ip: req.ip };
  }
  private ttls() {
    return { accessTtl: this.auth.accessTtl, refreshTtl: this.auth.refreshTtl };
  }

  @Post('signup')
  @Throttle(tight)
  async signup(@Body() dto: SignupDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signup(dto.email, dto.password, dto.name);
    const tokens = await this.auth.issueTokens(user, this.meta(req));
    setAuthCookies(res, tokens, this.ttls());
    return { user: UsersService.toPublic(user) };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(tight)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateLogin(dto.email, dto.password);
    const tokens = await this.auth.issueTokens(user, this.meta(req));
    setAuthCookies(res, tokens, this.ttls());
    return { user: UsersService.toPublic(user) };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refresh_token'];
    if (!token) throw new UnauthorizedException('No refresh token.');
    const { user, accessToken, refreshToken } = await this.auth.rotateRefresh(token, this.meta(req));
    setAuthCookies(res, { accessToken, refreshToken }, this.ttls());
    return { user: UsersService.toPublic(user) };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.['refresh_token']);
    clearAuthCookies(res);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.users.findById(current.id);
    if (!user) throw new UnauthorizedException();
    return { user: UsersService.toPublic(user) };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle(tight)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { ok: true, sent: true };
  }

  @Post('resend-verification')
  @HttpCode(200)
  @Throttle(tight)
  async resendVerification(@Body() dto: ForgotPasswordDto) {
    await this.auth.resendVerification(dto.email);
    return { ok: true, sent: true };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body('token') token: string) {
    await this.auth.verifyEmail(token);
    return { ok: true };
  }

  // --- Google OAuth ---------------------------------------------------------

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  googleAuth() {
    // Guard redirects to Google.
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleCallback(@Req() req: Request & { user?: AuthUser }, @Res() res: Response) {
    const appUrl = this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:4200';
    const current = req.user;
    if (!current) return res.redirect(`${appUrl}/login?error=google`);
    const user = await this.users.findById(current.id);
    if (!user) return res.redirect(`${appUrl}/login?error=google`);
    const tokens = await this.auth.issueTokens(user, this.meta(req));
    setAuthCookies(res, tokens, this.ttls());
    return res.redirect(`${appUrl}/dashboard`);
  }
}
