import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { buildAuthorizeUrl, isConfigured, STATE_COOKIE } from '@/lib/figma-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Figma login is not configured. Set FIGMA_OAUTH_CLIENT_ID and FIGMA_OAUTH_CLIENT_SECRET.' },
      { status: 503 },
    );
  }
  const state = crypto.randomBytes(16).toString('hex');
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
