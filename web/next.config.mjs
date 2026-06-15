/** @type {import('next').NextConfig} */
const nextConfig = {
  // Generic Node deployment (self-host / VM / Node host). Produces a
  // self-contained server in .next/standalone — hosting decided later.
  output: 'standalone',
  reactStrictMode: true,
  // Repo root has its own lockfile; pin tracing to this app to avoid the
  // multi-lockfile warning and keep standalone output self-contained.
  outputFileTracingRoot: import.meta.dirname,
  // Auth + QA + reports are all served by the NestJS backend (NEXT_PUBLIC_API_URL),
  // called directly with credentials — no Next-side proxy needed.
};

export default nextConfig;
