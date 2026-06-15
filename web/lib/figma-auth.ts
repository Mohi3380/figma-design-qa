import crypto from 'node:crypto';

/**
 * Figma OAuth 2 helpers (server-only).
 *
 * Flow:
 *   /api/auth/login    → redirect to https://www.figma.com/oauth
 *   /api/auth/callback → exchange code at https://api.figma.com/v1/oauth/token,
 *                        seal the token into an httpOnly cookie
 *   /api/run           → reads the cookie, forwards the access token to the
 *                        pipeline backend as the user's Figma credential
 *
 * The owner registers one Figma app and sets these env vars; end users only
 * click "Login with Figma".
 */

export const AUTHORIZE_URL = 'https://www.figma.com/oauth';
export const TOKEN_URL = 'https://api.figma.com/v1/oauth/token';
export const REFRESH_URL = 'https://api.figma.com/v1/oauth/refresh';
export const SCOPES = 'file_content:read,file_metadata:read';

export const SESSION_COOKIE = 'kl_figma';
export const STATE_COOKIE = 'kl_oauth_state';

export interface FigmaSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // epoch ms
  user_id?: string;
}

export function oauthConfig() {
  return {
    clientId: process.env.FIGMA_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.FIGMA_OAUTH_CLIENT_SECRET || '',
    redirectUri: process.env.FIGMA_OAUTH_REDIRECT_URI || 'http://localhost:4200/api/auth/callback',
  };
}

export function isConfigured(): boolean {
  const c = oauthConfig();
  return Boolean(c.clientId && c.clientSecret);
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = oauthConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    response_type: 'code',
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = oauthConfig();
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user_id_string?: string;
  user_id?: string;
}

export async function exchangeCode(code: string): Promise<FigmaSession> {
  const { redirectUri } = oauthConfig();
  const body = new URLSearchParams({ redirect_uri: redirectUri, code, grant_type: 'authorization_code' });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuthHeader() },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Figma token exchange failed (${res.status}) ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as TokenResponse;
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    user_id: j.user_id_string || j.user_id,
  };
}

// --- sealed cookie (AES-256-GCM) -------------------------------------------

function key(): Buffer {
  const secret = process.env.SESSION_SECRET || 'dev-insecure-secret-change-me';
  return crypto.createHash('sha256').update(secret).digest();
}

export function seal(session: FigmaSession): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function unseal(value: string | undefined): FigmaSession | null {
  if (!value) return null;
  try {
    const buf = Buffer.from(value, 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8')) as FigmaSession;
  } catch {
    return null;
  }
}
