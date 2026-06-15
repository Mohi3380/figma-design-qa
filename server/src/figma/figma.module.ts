import { Module } from '@nestjs/common';
import { FigmaService } from './figma.service';
import { FigmaController } from './figma.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  controllers: [FigmaController],
  providers: [FigmaService, JwtAuthGuard],
  exports: [FigmaService],
})
export class FigmaModule {}
