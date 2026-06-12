/** @type {import('next').NextConfig} */
const nextConfig = {
  // Generic Node deployment (self-host / VM / Node host). Produces a
  // self-contained server in .next/standalone — hosting decided later.
  output: 'standalone',
  reactStrictMode: true,
  // Repo root has its own lockfile; pin tracing to this app to avoid the
  // multi-lockfile warning and keep standalone output self-contained.
  outputFileTracingRoot: import.meta.dirname,
  // The QA engine (Playwright + Figma + Anthropic) runs as a separate Node
  // service — the existing pipeline server. Next proxies the streaming run
  // and the rendered report to it instead of rebundling those heavy deps.
  async rewrites() {
    const backend = (process.env.QA_BACKEND_URL || 'http://127.0.0.1:4100').replace(/\/+$/, '');
    return [
      { source: '/api/run', destination: `${backend}/run` },
      { source: '/report', destination: `${backend}/report` },
    ];
  },
};

export default nextConfig;
