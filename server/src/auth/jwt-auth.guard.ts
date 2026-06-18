import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { getSecret } from '../config/secrets.util';

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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser; cookies?: Record<string, string> }>();
    const fromCookie = req.cookies?.['access_token'];
    const auth = req.headers.authorization;
    const fromHeader = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const token = fromCookie ?? fromHeader;
    if (!token) throw new UnauthorizedException('Authentication required.');

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token, {
        secret: getSecret(this.config, 'JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
      req.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }
  }
}
