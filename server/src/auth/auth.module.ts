import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleStrategy } from './google.strategy';
import { UsersModule } from '../users/users.module';

// Only register the Google strategy when configured (it requires real creds at
// construction); the route guard returns 503 until then.
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

@Module({
  imports: [UsersModule, PassportModule.register({ session: false }), JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, ...(googleConfigured ? [GoogleStrategy] : [])],
  exports: [AuthService],
})
export class AuthModule {}
