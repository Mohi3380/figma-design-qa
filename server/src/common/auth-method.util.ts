import type { Prisma } from '@prisma/client';

/**
 * The single definition of how an account's sign-in method is classified, used
 * by BOTH the per-row label (admin user table / detail) AND the aggregate
 * counts + filters (admin stats split, users-list filter). Keeping the row
 * classifier and the Prisma where-fragments here means the "what is a google
 * account" rule can't drift between the label a user sees and the numbers/
 * filters — previously these were defined three different (inconsistent) ways.
 *
 *   password — no Google link (the account signs in with email + password)
 *   google   — linked to Google, no local password set
 *   both     — linked to Google AND has a local password
 */
export type AuthMethod = 'google' | 'password' | 'both';

export function authMethodOf(u: { googleId: string | null; passwordHash: string | null }): AuthMethod {
  if (u.googleId && u.passwordHash) return 'both';
  if (u.googleId) return 'google';
  return 'password';
}

/** Prisma `where` fragments selecting exactly the rows authMethodOf would label
 * with each value — so counts and filters agree with the displayed label. */
export const AUTH_METHOD_WHERE: Record<AuthMethod, Prisma.UserWhereInput> = {
  password: { googleId: null },
  google: { googleId: { not: null }, passwordHash: null },
  both: { googleId: { not: null }, passwordHash: { not: null } },
};
