import { Module } from '@nestjs/common';
import { TeamService } from './team.service';
import { AdminTeamController, PublicTeamController } from './team.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  controllers: [PublicTeamController, AdminTeamController],
  providers: [TeamService, JwtAuthGuard, AdminGuard],
})
export class TeamModule {}
