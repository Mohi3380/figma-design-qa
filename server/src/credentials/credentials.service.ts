import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/crypto.util';
import { getSecret } from '../config/secrets.util';

export type Provider = 'figma' | 'anthropic';

export interface UsableToken {
  token: string;
  scheme: 'oauth' | 'pat';
}

const FIGMA_REFRESH_URL = 'https://api.figma.com/v1/oauth/refresh';
const FIGMA_ME_URL = 'https://api.figma.com/v1/me';

/**
 * The single source of truth for per-user third-party credentials (Figma,
 * Anthropic). Secrets are AES-256-GCM encrypted at rest and NEVER returned to a
 * client or logged. There is deliberately NO global/shared fallback token: a QA
 * run can only ever use the requesting user's own credential, and every read is
 * guarded by a hard owner-match assertion that fails closed.
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private encSecret(): string {
    return getSecret(this.config, 'TOKEN_ENC_SECRET');
  }

  figmaOAuthConfigured(): boolean {
    return Boolean(
      this.config.get('FIGMA_OAUTH_CLIENT_ID') && this.config.get('FIGMA_OAUTH_CLIENT_SECRET'),
    );
  }

  private figmaBasicAuth(): string {
    const id = this.config.get<string>('FIGMA_OAUTH_CLIENT_ID') ?? '';
    const secret = this.config.get<string>('FIGMA_OAUTH_CLIENT_SECRET') ?? '';
    return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  }

  /**
   * Fetch a user's credential for a provider, asserting ownership. This is the
   * choke point every credential read passes through — the `where` already
   * scopes by userId, and the explicit re-check makes the isolation invariant a
   * hard, fail-closed assertion rather than an implicit query property.
   */
  private async ownedCredential(userId: string, provider: Provider) {
    if (!userId) {
      throw new InternalServerErrorException('Missing user context for credential lookup.');
    }
    const cred = await this.prisma.apiCredential.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!cred) return null;
    // Belt-and-suspenders: a credential must belong to the requesting user.
    // Never allow one user's token to be handed to another user's request.
    if (cred.userId !== userId) {
      throw new InternalServerErrorException('Credential ownership assertion failed.');
    }
    return cred;
  }

  // ---- resolution (used by the QA worker) -------------------------------

  /** The Figma token a QA run should use — the user's own, or null. No fallback. */
  async getFigmaToken(userId: string): Promise<UsableToken | null> {
    const cred = await this.ownedCredential(userId, 'figma');
    if (!cred) return null;
    let token = decryptSecret(cred.secretEnc, this.encSecret());
    if (cred.type === 'oauth' && cred.expiresAt && cred.expiresAt < new Date() && cred.refreshTokenEnc) {
      token = (await this.refreshFigma(userId, cred.refreshTokenEnc)) ?? token;
    }
    return { token, scheme: cred.type === 'pat' ? 'pat' : 'oauth' };
  }

  /** The user's own Anthropic key for vision, or null. No platform fallback. */
  async getAnthropicKey(userId: string): Promise<string | null> {
    const cred = await this.ownedCredential(userId, 'anthropic');
    if (!cred) return null;
    return decryptSecret(cred.secretEnc, this.encSecret());
  }

  // ---- storage ----------------------------------------------------------

  async storeFigmaOAuth(
    userId: string,
    data: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; figmaUserId?: string | null },
  ): Promise<void> {
    const secret = this.encSecret();
    const row = {
      type: 'oauth',
      secretEnc: encryptSecret(data.accessToken, secret),
      refreshTokenEnc: data.refreshToken ? encryptSecret(data.refreshToken, secret) : null,
      expiresAt: data.expiresAt ?? null,
      accountLabel: data.figmaUserId ?? 'Figma account',
    };
    await this.prisma.apiCredential.upsert({
      where: { userId_provider: { userId, provider: 'figma' } },
      create: { userId, provider: 'figma', ...row },
      update: row,
    });
  }

  /** Save a per-user Figma personal access token, validating it live first. */
  async setFigmaPat(userId: string, token: string): Promise<{ account: string }> {
    const trimmed = (token ?? '').trim();
    if (!trimmed) throw new BadRequestException('A Figma token is required.');
    const account = await this.validateFigmaPat(trimmed);
    const row = {
      type: 'pat',
      secretEnc: encryptSecret(trimmed, this.encSecret()),
      refreshTokenEnc: null,
      expiresAt: null,
      accountLabel: account,
    };
    await this.prisma.apiCredential.upsert({
      where: { userId_provider: { userId, provider: 'figma' } },
      create: { userId, provider: 'figma', ...row },
      update: row,
    });
    return { account };
  }

  /** Save a per-user Anthropic API key (format-checked; never validated by a billed call). */
  async setAnthropicKey(userId: string, key: string): Promise<void> {
    const trimmed = (key ?? '').trim();
    if (!/^sk-ant-/.test(trimmed)) {
      throw new BadRequestException('That does not look like an Anthropic API key (expected an "sk-ant-…" key).');
    }
    const row = {
      type: 'pat',
      secretEnc: encryptSecret(trimmed, this.encSecret()),
      refreshTokenEnc: null,
      expiresAt: null,
      accountLabel: 'Anthropic key',
    };
    await this.prisma.apiCredential.upsert({
      where: { userId_provider: { userId, provider: 'anthropic' } },
      create: { userId, provider: 'anthropic', ...row },
      update: row,
    });
  }

  async disconnect(userId: string, provider: Provider): Promise<void> {
    await this.prisma.apiCredential.deleteMany({ where: { userId, provider } });
  }

  /** Connection status for the UI — booleans + labels only, never the secret. */
  async status(userId: string) {
    const creds = await this.prisma.apiCredential.findMany({
      where: { userId },
      select: { provider: true, type: true, accountLabel: true, updatedAt: true },
    });
    const figma = creds.find((c) => c.provider === 'figma');
    const anthropic = creds.find((c) => c.provider === 'anthropic');
    return {
      figma: {
        oauthConfigured: this.figmaOAuthConfigured(),
        connected: Boolean(figma),
        type: figma?.type ?? null,
        account: figma?.accountLabel ?? null,
        updatedAt: figma?.updatedAt ?? null,
      },
      anthropic: {
        connected: Boolean(anthropic),
        updatedAt: anthropic?.updatedAt ?? null,
      },
    };
  }

  // ---- internals --------------------------------------------------------

  private async validateFigmaPat(token: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(FIGMA_ME_URL, { headers: { 'X-Figma-Token': token } });
    } catch {
      throw new BadRequestException('Could not reach Figma to validate the token.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException(
        'Figma rejected that token. Make sure it has the "file_content:read" scope.',
      );
    }
    if (!res.ok) {
      throw new BadRequestException(`Could not validate the Figma token (HTTP ${res.status}).`);
    }
    const me = (await res.json().catch(() => ({}))) as { handle?: string; email?: string; id?: string };
    return me.handle || me.email || me.id || 'Figma token';
  }

  private async refreshFigma(userId: string, refreshTokenEnc: string): Promise<string | null> {
    try {
      const refreshToken = decryptSecret(refreshTokenEnc, this.encSecret());
      const res = await fetch(FIGMA_REFRESH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: this.figmaBasicAuth(),
        },
        body: new URLSearchParams({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { access_token: string; expires_in?: number };
      await this.prisma.apiCredential.update({
        where: { userId_provider: { userId, provider: 'figma' } },
        data: {
          secretEnc: encryptSecret(j.access_token, this.encSecret()),
          expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
        },
      });
      return j.access_token;
    } catch {
      return null;
    }
  }
}
