import { Module } from '@nestjs/common';
import { QaService } from './qa.service';
import { QaController } from './qa.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [CredentialsModule],
  controllers: [QaController],
  providers: [QaService, JwtAuthGuard],
})
export class QaModule {}
