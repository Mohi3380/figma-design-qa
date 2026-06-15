import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode, seal, SESSION_COOKIE, STATE_COOKIE } from '@/lib/figma-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;
  const home = new URL('/#run', url.origin);

  if (url.searchParams.get('error')) {
    home.searchParams.set('figma', 'denied');
    return NextResponse.redirect(home);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    home.searchParams.set('figma', 'error');
    return NextResponse.redirect(home);
  }

  try {
    const session = await exchangeCode(code);
    const res = NextResponse.redirect(new URL('/?figma=connected#run', url.origin));
    res.cookies.set(SESSION_COOKIE, seal(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch {
    home.searchParams.set('figma', 'error');
    return NextResponse.redirect(home);
  }
}
