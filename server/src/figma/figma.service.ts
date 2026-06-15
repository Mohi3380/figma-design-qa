import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/crypto.util';

const AUTHORIZE_URL = 'https://www.figma.com/oauth';
const TOKEN_URL = 'https://api.figma.com/v1/oauth/token';
const REFRESH_URL = 'https://api.figma.com/v1/oauth/refresh';
const SCOPES = 'file_content:read,file_metadata:read';

export interface UsableToken {
  token: string;
  scheme: 'oauth' | 'pat';
}

/** Per-user Figma OAuth connection + token resolution for QA runs. */
@Injectable()
export class FigmaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('FIGMA_OAUTH_CLIENT_ID') && this.config.get('FIGMA_OAUTH_CLIENT_SECRET'),
    );
  }

  private encSecret(): string {
    return this.config.get<string>('TOKEN_ENC_SECRET') ?? 'dev-token-encryption-secret';
  }
  private redirectUri(): string {
    return (
      this.config.get<string>('FIGMA_OAUTH_REDIRECT_URI') ??
      'http://localhost:4300/api/figma/callback'
    );
  }

  buildAuthorizeUrl(state: string): string {
    const p = new URLSearchParams({
      client_id: this.config.get<string>('FIGMA_OAUTH_CLIENT_ID') ?? '',
      redirect_uri: this.redirectUri(),
      scope: SCOPES,
      state,
      response_type: 'code',
    });
    return `${AUTHORIZE_URL}?${p.toString()}`;
  }

  private basicAuth(): string {
    const id = this.config.get<string>('FIGMA_OAUTH_CLIENT_ID') ?? '';
    const secret = this.config.get<string>('FIGMA_OAUTH_CLIENT_SECRET') ?? '';
    return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  }

  async exchangeAndStore(userId: string, code: string): Promise<void> {
    const body = new URLSearchParams({
      redirect_uri: this.redirectUri(),
      code,
      grant_type: 'authorization_code',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: this.basicAuth() },
      body,
    });
    if (!res.ok) throw new Error(`Figma token exchange failed (${res.status})`);
    const j = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      user_id_string?: string;
    };
    const secret = this.encSecret();
    const data = {
      accessTokenEnc: encryptSecret(j.access_token, secret),
      refreshTokenEnc: j.refresh_token ? encryptSecret(j.refresh_token, secret) : null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      figmaUserId: j.user_id_string ?? null,
    };
    await this.prisma.figmaConnection.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  async getStatus(userId: string): Promise<{ configured: boolean; connected: boolean }> {
    const conn = await this.prisma.figmaConnection.findUnique({ where: { userId } });
    return { configured: this.isConfigured(), connected: Boolean(conn) };
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.figmaConnection.deleteMany({ where: { userId } });
  }

  /** The token a QA run should use: the user's connection, else a server PAT. */
  async getUsableToken(userId: string): Promise<UsableToken | null> {
    const conn = await this.prisma.figmaConnection.findUnique({ where: { userId } });
    if (conn) {
      let token = decryptSecret(conn.accessTokenEnc, this.encSecret());
      if (conn.expiresAt && conn.expiresAt < new Date() && conn.refreshTokenEnc) {
        token = (await this.refresh(userId, conn.refreshTokenEnc)) ?? token;
      }
      return { token, scheme: 'oauth' };
    }
    const pat = this.config.get<string>('FIGMA_TOKEN');
    return pat ? { token: pat, scheme: 'pat' } : null;
  }

  private async refresh(userId: string, refreshTokenEnc: string): Promise<string | null> {
    try {
      const refreshToken = decryptSecret(refreshTokenEnc, this.encSecret());
      const res = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: this.basicAuth() },
        body: new URLSearchParams({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { access_token: string; expires_in?: number };
      const secret = this.encSecret();
      await this.prisma.figmaConnection.update({
        where: { userId },
        data: {
          accessTokenEnc: encryptSecret(j.access_token, secret),
          expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
        },
      });
      return j.access_token;
    } catch {
      return null;
    }
  }
}
