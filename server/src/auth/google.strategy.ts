import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from './auth.service';
import { cookieOptions } from './cookies';
import { randomToken } from '../common/crypto.util';

/** Cookie that binds the Google OAuth redirect to the browser that started it. */
export const GOOGLE_STATE_COOKIE = 'google_oauth_state';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      clientID: config.get<string>('GOOGLE_CLIENT_ID') ?? 'unconfigured',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') ?? 'unconfigured',
      callbackURL:
        config.get<string>('GOOGLE_CALLBACK_URL') ?? 'http://localhost:4300/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(_at: string, _rt: string, profile: Profile, done: VerifyCallback): Promise<void> {
    const email = profile.emails?.[0]?.value;
    if (!email) return done(new Error('Google account has no email'), undefined);
    const user = await this.auth.findOrCreateGoogleUser({
      googleId: profile.id,
      email,
      name: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
    });
    done(null, { id: user.id, email: user.email });
  }
}

/** Returns 503 until Google creds are configured, instead of a strategy error. */
@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService) {
    super();
  }
  canActivate(context: ExecutionContext) {
    if (!this.config.get<string>('GOOGLE_CLIENT_ID') || !this.config.get<string>('GOOGLE_CLIENT_SECRET')) {
      throw new ServiceUnavailableException('Google login is not configured.');
    }
    return super.canActivate(context);
  }

  /**
   * CSRF protection for the OAuth dance. On the INITIAL /auth/google request
   * (no `code` yet), mint a random `state`, drop it in an httpOnly cookie, and
   * forward it to Google. Google echoes it back on the callback, where the
   * controller compares it to the cookie — so an attacker cannot complete a
   * login the victim's browser never initiated (login CSRF / forced sign-in).
   * PassportModule runs with `session: false`, so there is no server-side store
   * to verify against; the cookie is the binding instead (mirrors the Figma flow).
   */
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.query?.code) return {}; // callback leg — state already chosen
    const res = context.switchToHttp().getResponse<Response>();
    const state = randomToken(16);
    res.cookie(GOOGLE_STATE_COOKIE, state, cookieOptions(600));
    return { state };
  }
}
