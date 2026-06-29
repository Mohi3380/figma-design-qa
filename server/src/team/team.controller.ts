import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { StorageService } from '../storage/storage.service';
import { randomToken } from '../common/crypto.util';
import { CreateTeamMemberDto, ReorderTeamDto, UpdateTeamMemberDto } from './dto/team.dto';

// Same allow-list and 2 MB limit as user avatars; files land in the shared
// `avatars/` bucket served by the public GET /users/avatars/:filename route.
const AVATAR_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

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
  constructor(
    private readonly team: TeamService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list() {
    return this.team.adminList();
  }

  @Post()
  create(@Body() dto: CreateTeamMemberDto) {
    return this.team.create(dto);
  }

  // Upload an avatar image and get back a public URL to store on a member.
  // Decoupled from a member id so it works for both new and existing members.
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(@UploadedFile() file?: UploadedImage) {
    if (!file) throw new BadRequestException('No file uploaded.');
    const ext = AVATAR_MIME[file.mimetype];
    if (!ext) throw new BadRequestException('Only JPG, PNG, or WebP images are allowed.');
    const filename = `${randomToken(16)}.${ext}`;
    await this.storage.putBuffer(`avatars/${filename}`, file.buffer, file.mimetype);
    const base = (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:4300/api').replace(/\/+$/, '');
    return { url: `${base}/users/avatars/${filename}` };
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
