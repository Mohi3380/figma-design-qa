import { Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { CredentialsController } from './credentials.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  controllers: [CredentialsController],
  providers: [CredentialsService, JwtAuthGuard],
  exports: [CredentialsService],
})
export class CredentialsModule {}
