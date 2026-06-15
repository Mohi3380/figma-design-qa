import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/figma-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/', new URL(req.url).origin));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
