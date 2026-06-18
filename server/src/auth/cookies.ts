import type { Response } from 'express';
import { isProduction } from '../config/secrets.util';

/** Shared cookie attributes (httpOnly + prod-only secure + lax + root path). */
export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

const base = cookieOptions;

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
  ttls: { accessTtl: number; refreshTtl: number },
): void {
  res.cookie('access_token', tokens.accessToken, base(ttls.accessTtl));
  res.cookie('refresh_token', tokens.refreshToken, base(ttls.refreshTtl));
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
}
