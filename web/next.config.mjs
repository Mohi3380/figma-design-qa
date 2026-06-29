/** @type {import('next').NextConfig} */
const nextConfig = {
  // Generic Node deployment (self-host / VM / Node host). Produces a
  // self-contained server in .next/standalone — hosting decided later.
  output: 'standalone',
  reactStrictMode: true,
  // Repo root has its own lockfile; pin tracing to this app to avoid the
  // multi-lockfile warning and keep standalone output self-contained.
  outputFileTracingRoot: import.meta.dirname,
  // Proxy /api/* to the NestJS backend so the browser talks to it same-origin.
  // This is what lets the app work behind a tunnel (ngrok) or any host: no CORS,
  // no mixed-content, and the auth cookies stay first-party. The backend's own
  // origin is server-side only (never exposed to the client).
  async rewrites() {
    const target = (process.env.API_INTERNAL_URL || 'http://localhost:4300/api').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${target}/:path*` }];
  },
};

export default nextConfig;
