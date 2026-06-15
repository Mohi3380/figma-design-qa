import { z } from 'zod';

/**
 * Environment validation. Most keys are optional during early phases so the
 * server boots before the DB/auth/Figma config exists; they become required
 * as their features land.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4300),
    CORS_ORIGINS: z.string().default('http://localhost:4200'),
    DATABASE_URL: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
  })
  .passthrough();

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
