import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { getSecret } from '../config/secrets.util';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser {
  id: string;
  email: string;
}

/** Authenticates via the access_token cookie (or Authorization: Bearer). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser; cookies?: Record<string, string> }>();
    const fromCookie = req.cookies?.['access_token'];
    const auth = req.headers.authorization;
    const fromHeader = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const token = fromCookie ?? fromHeader;
    if (!token) throw new UnauthorizedException('Authentication required.');

    let payload: { sub: string; email: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token, {
        secret: getSecret(this.config, 'JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // Access tokens are stateless and short-lived, but "disabled" and "deleted"
    // must take effect immediately — not only once the token expires. Re-check
    // the account state from the DB on every request (one indexed PK lookup),
    // mirroring AdminGuard. Without this, a disabled user keeps full access for
    // the remainder of the access-token TTL.
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { disabledAt: true },
    });
    if (!account) throw new UnauthorizedException('Invalid or expired session.');
    if (account.disabledAt) {
      throw new UnauthorizedException('This account has been disabled. Contact an administrator.');
    }

    req.user = { id: payload.sub, email: payload.email };
    return true;
  }
}
