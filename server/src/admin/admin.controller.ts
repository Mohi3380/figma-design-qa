import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListUsersDto } from './dto/list-users.dto';
import { SetDisabledDto, SetRoleDto } from './dto/admin-actions.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('activity')
  activity() {
    return this.admin.activity();
  }

  // Declared before `users/:id` so the static segment wins the route match.
  @Get('users/export.csv')
  async exportCsv(@Query() dto: ListUsersDto, @Res() res: Response) {
    const csv = await this.admin.exportUsersCsv(dto);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  }

  @Get('users')
  listUsers(@Query() dto: ListUsersDto) {
    return this.admin.listUsers(dto);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Patch('users/:id/role')
  setRole(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: SetRoleDto) {
    return this.admin.setRole(actor.id, id, dto.role);
  }

  @Patch('users/:id/disable')
  setDisabled(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: SetDisabledDto) {
    return this.admin.setDisabled(actor.id, id, dto.disabled);
  }

  @Post('users/:id/verify')
  @HttpCode(200)
  verify(@Param('id') id: string) {
    return this.admin.verifyEmail(id);
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(200)
  revoke(@Param('id') id: string) {
    return this.admin.revokeSessions(id);
  }

  @Delete('users/:id')
  @HttpCode(200)
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.deleteUser(actor.id, id);
  }
}
