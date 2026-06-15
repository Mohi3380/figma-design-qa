import type { Response } from 'express';

const isProd = process.env.NODE_ENV === 'production';

function base(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

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
