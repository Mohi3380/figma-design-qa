import { Module } from '@nestjs/common';
import { QaService } from './qa.service';
import { QaController } from './qa.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FigmaModule } from '../figma/figma.module';

@Module({
  imports: [FigmaModule],
  controllers: [QaController],
  providers: [QaService, JwtAuthGuard],
})
export class QaModule {}
