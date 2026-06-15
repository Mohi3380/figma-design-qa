import { NextRequest } from 'next/server';
import { SESSION_COOKIE, unseal } from '@/lib/figma-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streams a QA run from the pipeline backend (SSE). If the visitor is logged in
 * with Figma, their access token is forwarded so the run uses *their* file
 * access; otherwise the backend falls back to its configured server token.
 */
export async function GET(req: NextRequest) {
  const backend = (process.env.QA_BACKEND_URL || 'http://127.0.0.1:4100').replace(/\/+$/, '');
  const qs = new URL(req.url).search;

  const session = unseal(req.cookies.get(SESSION_COOKIE)?.value);
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (session?.access_token) headers['x-figma-access-token'] = session.access_token;

  let upstream: Response;
  try {
    upstream = await fetch(`${backend}/run${qs}`, { headers });
  } catch {
    const body = `event: error\ndata: ${JSON.stringify({ message: 'QA backend is not reachable.' })}\n\n`;
    return new Response(body, { status: 200, headers: sseHeaders() });
  }

  return new Response(upstream.body, { status: upstream.status, headers: sseHeaders() });
}

function sseHeaders(): Record<string, string> {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  };
}
