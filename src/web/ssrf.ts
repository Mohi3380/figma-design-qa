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

/**
 * Expand any IPv6 literal to its 8 hextets (0..0xffff), handling "::"
 * compression and a trailing dotted-quad (e.g. ::ffff:1.2.3.4). Returns null
 * for anything unparseable. This lets classifyIp decode an embedded IPv4 no
 * matter how it's written.
 */
function ipv6ToHextets(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]; // drop any zone id
  // Fold a trailing dotted IPv4 into two hex groups so the dotted and hex
  // forms collapse to the same representation.
  const dotted = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.replace(
      /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
      `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`,
    );
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  } else {
    groups = left;
  }
  if (groups.length !== 8) return null;
  const hextets = groups.map((g) => parseInt(g, 16));
  if (hextets.some((h) => Number.isNaN(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}

function classifyIp(ip: string): IpClass {
  const v = isIP(ip);
  if (v === 4) return classifyIpv4(ip);
  if (v === 6) {
    const h = ipv6ToHextets(ip);
    if (!h) return 'reserved'; // unparseable → treat as unsafe
    if (h.every((x) => x === 0)) return 'reserved'; // :: (unspecified)
    const topZero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
    if (topZero && h[5] === 0 && h[6] === 0 && h[7] === 1) return 'loopback'; // ::1
    // SECURITY: IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96) embed an
    // IPv4 in the low 32 bits. `new URL()` normalizes these to HEX (e.g.
    // ::ffff:7f00:1), so we must decode the embedded v4 and classify *that* —
    // otherwise http://[::ffff:7f00:1]/ (127.0.0.1) or [::ffff:a9fe:a9fe]
    // (169.254.169.254 metadata) would slip through classified as 'global'.
    if (topZero && (h[5] === 0xffff || h[5] === 0)) {
      const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
      return classifyIpv4(v4);
    }
    if ((h[0] & 0xffc0) === 0xfe80) return 'linklocal'; // fe80::/10
    if ((h[0] & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 ULA
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
