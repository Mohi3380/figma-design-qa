/**
 * Response-shaping safety: UsersService.toPublic is a strict whitelist
 * (PublicUserDto), so a sensitive column on the User row can never leak through
 * it. This is the tripwire that replaces "remember to not spread the row".
 */
import { describe, expect, it } from 'vitest';
import { UsersService } from '../src/users/users.service';

// A row carrying every sensitive field we must never expose.
const fullRow = {
  id: 'u1',
  email: 'a@b.com',
  name: 'Alice',
  emailVerified: true,
  avatarUrl: null,
  role: 'USER',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  disabledAt: null,
  passwordHash: 'SECRET-BCRYPT-HASH',
  googleId: 'google-oauth-id-123',
} as never;

describe('UsersService.toPublic', () => {
  it('exposes exactly the public fields', () => {
    const pub = UsersService.toPublic(fullRow) as Record<string, unknown>;
    expect(Object.keys(pub).sort()).toEqual(
      ['avatarUrl', 'createdAt', 'email', 'emailVerified', 'hasPassword', 'id', 'name', 'role'].sort(),
    );
  });

  it('never leaks sensitive fields even when present on the row', () => {
    const json = JSON.stringify(UsersService.toPublic(fullRow));
    expect(json).not.toContain('SECRET-BCRYPT-HASH');
    expect(json).not.toContain('google-oauth-id-123');
    expect(json).not.toMatch(/passwordHash|googleId/);
  });

  it('derives hasPassword without exposing the hash', () => {
    expect(UsersService.toPublic(fullRow).hasPassword).toBe(true);
    expect(UsersService.toPublic({ ...(fullRow as object), passwordHash: null } as never).hasPassword).toBe(false);
  });
});
