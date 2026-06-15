import { Module } from '@nestjs/common';
import { FigmaService } from './figma.service';
import { FigmaController } from './figma.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FigmaController],
  providers: [FigmaService],
  exports: [FigmaService],
})
export class FigmaModule {}
