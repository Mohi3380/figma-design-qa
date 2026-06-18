import { ConfigService } from '@nestjs/config';

/** Parse ADMIN_EMAILS (comma/space separated) into a lowercased set. */
export function adminEmails(config: ConfigService): Set<string> {
  const raw = config.get<string>('ADMIN_EMAILS') ?? '';
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(config: ConfigService, email: string): boolean {
  return adminEmails(config).has(email.trim().toLowerCase());
}
