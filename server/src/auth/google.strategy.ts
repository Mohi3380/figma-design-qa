import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from './auth.service';

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
}
