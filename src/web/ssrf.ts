/**
 * SSRF protection for the live-capture step. The QA engine renders a
 * user-supplied URL server-side, so an attacker could otherwise point it at
 * internal services, RFC-1918 hosts, or cloud metadata endpoints.
 *
 * Policy:
 *  - Only http/https; no embedded credentials.
 *  - ALWAYS block link-local (169.254/16, incl. cloud metadata), unspecified,
 *    multicast/reserved, and known metadata hostnames — regardless of config.
 *  - Block loopback + private (RFC-1918 / ULA / CGNAT) UNLESS `allowPrivate`
 *    is set (this product legitimately QAs localhost/staging in dev, so the
 *    operator opts in via QA_ALLOW_PRIVATE_TARGETS=true; keep it off when hosted).
 *  - The browser is also guarded per-request (subresources + redirects) to
 *    blunt DNS-rebinding, not just the top-level navigation.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Page } from 'playwright';

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'metadata.goog']);

export class SsrfBlockedError extends Error {}

type IpClass = 'global' | 'loopback' | 'private' | 'linklocal' | 'reserved';

function classifyIpv4(ip: string): IpClass {
  const [a, b] = ip.split('.').map(Number);
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT
  if (a === 169 && b === 254) return 'linklocal'; // includes 169.254.169.254 metadata
  if (a === 0 || a >= 224) return 'reserved'; // 0.0.0.0/8, multicast/reserved
  return 'global';
}

function classifyIp(ip: string): IpClass {
  const v = isIP(ip);
  if (v === 4) return classifyIpv4(ip);
  if (v === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:1.2.3.4) → classify the embedded v4.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return classifyIpv4(mapped[1]);
    if (lower === '::1') return 'loopback';
    if (lower === '::') return 'reserved';
    if (/^fe[89ab]/.test(lower)) return 'linklocal'; // fe80::/10
    if (/^f[cd]/.test(lower)) return 'private'; // fc00::/7 ULA
    return 'global';
  }
  return 'reserved'; // not a parseable IP — treat as unsafe
}

async function resolveAll(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  try {
    const records = await lookup(host, { all: true });
    return records.map((r) => r.address);
  } catch {
    throw new SsrfBlockedError(`Could not resolve host "${host}".`);
  }
}

/** Returns null if allowed, or a reason string if blocked. */
function reasonForClass(cls: IpClass, ip: string, host: string, allowPrivate: boolean): string | null {
  if (cls === 'linklocal' || cls === 'reserved') {
    return `"${host}" resolves to a reserved/link-local address (${ip}).`;
  }
  if (!allowPrivate && (cls === 'loopback' || cls === 'private')) {
    return `"${host}" resolves to a private address (${ip}). Set QA_ALLOW_PRIVATE_TARGETS=true to allow local/internal targets.`;
  }
  return null;
}

async function hostBlockedReason(host: string, allowPrivate: boolean): Promise<string | null> {
  const clean = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (METADATA_HOSTS.has(clean)) return `"${host}" is a blocked metadata host.`;
  const addrs = await resolveAll(clean);
  for (const ip of addrs) {
    const r = reasonForClass(classifyIp(ip), ip, host, allowPrivate);
    if (r) return r;
  }
  return null;
}

/** Validate the top-level target URL before navigation. Throws on block. */
export async function assertSafeUrl(raw: string, opts: { allowPrivate: boolean }): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError(`Not a valid URL: "${raw}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Blocked URL scheme "${url.protocol}" — only http and https are allowed.`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('URLs with embedded credentials are not allowed.');
  }
  const reason = await hostBlockedReason(url.hostname, opts.allowPrivate);
  if (reason) throw new SsrfBlockedError(`Blocked target — ${reason}`);
  return url;
}

/**
 * Abort any browser request (navigation, subresource, or redirect target)
 * whose host fails the same policy — defends against DNS rebinding and
 * internal subresource fetches, not just the initial URL.
 */
export async function installSsrfGuard(page: Page, opts: { allowPrivate: boolean }): Promise<void> {
  const cache = new Map<string, boolean>(); // host -> allowed
  await page.route('**/*', async (route) => {
    try {
      const u = new URL(route.request().url());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.abort('blockedbyclient');
      const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      let allowed = cache.get(host);
      if (allowed === undefined) {
        allowed = (await hostBlockedReason(host, opts.allowPrivate)) === null;
        cache.set(host, allowed);
      }
      return allowed ? route.continue() : route.abort('blockedbyclient');
    } catch {
      return route.abort('blockedbyclient');
    }
  });
}
