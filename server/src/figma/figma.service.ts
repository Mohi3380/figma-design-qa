import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialsService } from '../credentials/credentials.service';

const AUTHORIZE_URL = 'https://www.figma.com/oauth';
const TOKEN_URL = 'https://api.figma.com/v1/oauth/token';
const SCOPES = 'file_content:read,file_metadata:read';

/**
 * The Figma OAuth authorization-code flow. Token storage/resolution lives in
 * CredentialsService — this service only drives the redirect dance and hands
 * the resulting tokens off to be encrypted per-user.
 */
@Injectable()
export class FigmaService {
  constructor(
    private readonly config: ConfigService,
    private readonly credentials: CredentialsService,
  ) {}

  isConfigured(): boolean {
    return this.credentials.figmaOAuthConfigured();
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

  async exchangeAndStore(userId: string, code: string): Promise<void> {
    const body = new URLSearchParams({
      redirect_uri: this.redirectUri(),
      code,
      grant_type: 'authorization_code',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Shared builder with the refresh path (CredentialsService).
        Authorization: this.credentials.figmaBasicAuth(),
      },
      body,
    });
    if (!res.ok) throw new Error(`Figma token exchange failed (${res.status})`);
    const j = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      user_id_string?: string;
    };
    await this.credentials.storeFigmaOAuth(userId, {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
      figmaUserId: j.user_id_string ?? null,
    });
  }
}
