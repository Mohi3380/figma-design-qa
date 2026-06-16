import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // SQLite + a shared temp DB: run files serially to avoid write contention.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
  esbuild: {
    // NestJS uses TypeScript legacy decorators.
    target: 'es2021',
  },
});
