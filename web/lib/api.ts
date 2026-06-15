/**
 * Thin client for the NestJS backend. Sends cookies (credentials: 'include')
 * so the httpOnly access/refresh JWTs flow cross-origin in dev. On a 401 it
 * transparently tries one refresh, then retries the request.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4300/api';

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
};
