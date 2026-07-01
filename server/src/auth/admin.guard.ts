import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './jwt-auth.guard';

/**
 * Authorizes admin-only routes. Must run AFTER JwtAuthGuard (which sets
 * req.user). Reads the role fresh from the DB so promote/demote and disable
 * take effect immediately — admin endpoints are low-traffic, so the extra
 * lookup is cheap and worth the correctness.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const id = req.user?.id;
    if (!id) throw new ForbiddenException('Admin access required.');
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, disabledAt: true },
    });
    if (!user || user.disabledAt || user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access required.');
    }
    return true;
  }
}
