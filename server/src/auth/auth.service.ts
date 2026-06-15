import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { hashToken, randomToken } from '../common/crypto.util';

export interface TokenMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private get accessSecret() {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret';
  }
  private get refreshSecret() {
    return this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret';
  }
  get accessTtl() {
    return Number(this.config.get('JWT_ACCESS_TTL') ?? 900);
  }
  get refreshTtl() {
    return Number(this.config.get('JWT_REFRESH_TTL') ?? 604800);
  }
  private get appBaseUrl() {
    return this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:4200';
  }

  async signup(email: string, password: string, name?: string): Promise<User> {
    const existing = await this.users.findByEmail(email);
    if (existing) throw new ConflictException('An account with that email already exists.');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.users.create({ email, name, passwordHash });
    await this.sendVerificationEmail(user);
    return user;
  }

  async validateLogin(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid email or password.');
    if (!user.passwordHash) {
      // Account was created via Google and has no password set.
      throw new UnauthorizedException('This account uses Google sign-in — use "Continue with Google".');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password.');
    return user;
  }

  async issueTokens(user: User, meta: TokenMeta = {}): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { secret: this.accessSecret, expiresIn: this.accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh', jti: randomToken(12) },
      { secret: this.refreshSecret, expiresIn: this.refreshTtl },
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtl * 1000),
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    return { accessToken, refreshToken };
  }

  async rotateRefresh(
    refreshToken: string,
    meta: TokenMeta = {},
  ): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired or revoked.');
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('User no longer exists.');
    const tokens = await this.issueTokens(user, meta);
    return { user, ...tokens };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --- email verification + password reset ---------------------------------

  private async sendVerificationEmail(user: User): Promise<void> {
    const raw = randomToken();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFICATION',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
    await this.mail.sendVerificationEmail(user.email, `${this.appBaseUrl}/verify-email?token=${raw}`);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!record || record.type !== 'EMAIL_VERIFICATION' || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification link.');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
      this.prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    // Per product requirement: confirm the email exists and tell the user.
    if (!user) throw new NotFoundException('No account found with that email address.');
    const raw = randomToken();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });
    await this.mail.sendPasswordResetEmail(user.email, `${this.appBaseUrl}/reset-password?token=${raw}`);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new NotFoundException('No account found with that email address.');
    if (user.emailVerified) throw new BadRequestException('This email is already verified.');
    await this.sendVerificationEmail(user);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!record || record.type !== 'PASSWORD_RESET' || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset link.');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // revoke all sessions on password change
      this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  /** Find-or-create a user from a verified Google profile. */
  async findOrCreateGoogleUser(profile: {
    googleId: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }): Promise<User> {
    const byGoogle = await this.users.findByGoogleId(profile.googleId);
    if (byGoogle) return byGoogle;
    const byEmail = await this.users.findByEmail(profile.email);
    if (byEmail) {
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId: profile.googleId, emailVerified: true, avatarUrl: byEmail.avatarUrl ?? profile.avatarUrl },
      });
    }
    return this.users.create({
      email: profile.email,
      name: profile.name,
      googleId: profile.googleId,
      emailVerified: true,
      avatarUrl: profile.avatarUrl,
    });
  }
}
