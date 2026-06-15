import { NextRequest, NextResponse } from 'next/server';
import { isConfigured, SESSION_COOKIE, unseal } from '@/lib/figma-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  return NextResponse.json({
    configured: isConfigured(),
    connected: Boolean(session?.access_token),
    userId: session?.user_id ?? null,
  });
}
