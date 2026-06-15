import { Module } from '@nestjs/common';
import { QaService } from './qa.service';
import { QaController } from './qa.controller';
import { AuthModule } from '../auth/auth.module';
import { FigmaModule } from '../figma/figma.module';

@Module({
  imports: [AuthModule, FigmaModule],
  controllers: [QaController],
  providers: [QaService],
})
export class QaModule {}
