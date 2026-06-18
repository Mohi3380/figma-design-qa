import type { ConfigService } from '@nestjs/config';

/**
 * Single source of truth for the dev-only fallback secrets. Production MUST
 * override every one of these: `env.validation.ts` derives its required-secrets
 * list and its rejected-defaults set from this object and fails fast at boot if
 * any is still in use. Keeping the literals here (instead of duplicated `??`
 * fallbacks scattered across services) means there is exactly one place to
 * audit and one place the validation has to stay in sync with.
 */
export const DEV_SECRET_FALLBACKS = {
  JWT_ACCESS_SECRET: 'dev-access-secret',
  JWT_REFRESH_SECRET: 'dev-refresh-secret',
  TOKEN_ENC_SECRET: 'dev-token-encryption-secret',
} as const;

export type SecretKey = keyof typeof DEV_SECRET_FALLBACKS;

/** Read a secret from config, falling back to the dev default (non-prod only — prod is enforced at boot). */
export function getSecret(config: ConfigService, key: SecretKey): string {
  return config.get<string>(key) ?? DEV_SECRET_FALLBACKS[key];
}

/** Whether the process is running in production. The one place NODE_ENV is read. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
