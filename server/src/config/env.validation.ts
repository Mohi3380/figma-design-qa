import { z } from 'zod';

/**
 * Environment validation. Most keys are optional during early phases so the
 * server boots before the DB/auth/Figma config exists; they become required
 * as their features land.
 */
// Secrets that have insecure dev fallbacks in code. They MUST be set to real
// values in production — otherwise sessions are forgeable and stored Figma
// tokens are weakly encrypted. We fail-fast at boot rather than silently run
// with the `dev-…` defaults. (Security review: required-secrets finding.)
const PROD_REQUIRED_SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TOKEN_ENC_SECRET'] as const;
const MIN_SECRET_LEN = 16;
const DEV_FALLBACKS = new Set(['dev-access-secret', 'dev-refresh-secret', 'dev-token-encryption-secret']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4300),
    CORS_ORIGINS: z.string().default('http://localhost:4200'),
    DATABASE_URL: z.string().optional(),
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
  })
  .passthrough()
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return; // dev/test may use the fallbacks
    for (const key of PROD_REQUIRED_SECRETS) {
      const val = (env as Record<string, unknown>)[key];
      if (typeof val !== 'string' || val.length < MIN_SECRET_LEN || DEV_FALLBACKS.has(val)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} must be set to a strong value (>= ${MIN_SECRET_LEN} chars, not a dev default) in production.`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
