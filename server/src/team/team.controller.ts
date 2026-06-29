import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CreateTeamMemberDto, ReorderTeamDto, UpdateTeamMemberDto } from './dto/team.dto';

// Public: the "Our Team" page reads this. No auth.
@Controller('team')
export class PublicTeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list() {
    return this.team.publicList();
  }
}

// Admin: manage the team roster. Same guards as the rest of the admin API.
@Controller('admin/team')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminTeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list() {
    return this.team.adminList();
  }

  @Post()
  create(@Body() dto: CreateTeamMemberDto) {
    return this.team.create(dto);
  }

  // Declared before `:id` so the static segment wins the route match.
  @Patch('reorder')
  reorder(@Body() dto: ReorderTeamDto) {
    return this.team.reorder(dto.ids);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTeamMemberDto) {
    return this.team.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id') id: string) {
    return this.team.remove(id);
  }
}
