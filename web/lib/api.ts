/**
 * Thin client for the NestJS backend. Sends cookies (credentials: 'include')
 * so the httpOnly access/refresh JWTs flow with each request. On a 401 it
 * transparently tries one refresh, then retries the request.
 *
 * In the browser the base is RELATIVE ('/api' by default) so requests are
 * same-origin and Next.js rewrites (see next.config.mjs) proxy them to the
 * backend. That avoids CORS/mixed-content and keeps the auth cookies
 * first-party — required when the app is served from a tunnel (ngrok) or any
 * host other than the backend's own. Server components can't use a relative
 * URL, so on the server we fall back to an absolute base.
 */
const BROWSER_API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';
const SERVER_API_BASE = process.env.API_INTERNAL_URL || 'http://localhost:4300/api';
export const API_BASE = typeof window === 'undefined' ? SERVER_API_BASE : BROWSER_API_BASE;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function raw(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  let res = await raw(path, options);

  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await raw('/auth/refresh', { method: 'POST' });
    if (refreshed.ok) res = await raw(path, options);
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.message
      ? Array.isArray(body.message)
        ? body.message.join(', ')
        : body.message
      : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const api = {
  get: <T = unknown>(p: string) => apiFetch<T>(p),
  post: <T = unknown>(p: string, data?: unknown) =>
    apiFetch<T>(p, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T = unknown>(p: string, data?: unknown) =>
    apiFetch<T>(p, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del: <T = unknown>(p: string) => apiFetch<T>(p, { method: 'DELETE' }),
};

/** Upload multipart form data (e.g. avatar). Lets the browser set the boundary. */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  let res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: form });
  if (res.status === 401) {
    const r = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (r.ok) res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: form });
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const m = body?.message;
    throw new ApiError(Array.isArray(m) ? m.join(', ') : m || `Upload failed (${res.status})`, res.status);
  }
  return body as T;
}
