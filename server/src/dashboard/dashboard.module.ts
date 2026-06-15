import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, JwtAuthGuard],
})
export class DashboardModule {}
