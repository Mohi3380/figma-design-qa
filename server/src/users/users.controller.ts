import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import path from 'node:path';
import { UsersService } from './users.service';
import { JwtAuthGuard, AuthUser } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { randomToken } from '../common/crypto.util';

const ALLOWED: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@CurrentUser() current: AuthUser, @Body() dto: UpdateProfileDto) {
    const user = await this.users.updateName(current.id, dto.name);
    return { user: UsersService.toPublic(user) };
  }

  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadAvatar(@CurrentUser() current: AuthUser, @UploadedFile() file?: UploadedImage) {
    if (!file) throw new BadRequestException('No file uploaded.');
    const ext = ALLOWED[file.mimetype];
    if (!ext) throw new BadRequestException('Only JPG, PNG, or WebP images are allowed.');
    // Opaque filename — no userId prefix. The avatar route is public (so <img>
    // can load it), so a guessable, identity-revealing name would let anyone
    // enumerate avatars and correlate them to a user id.
    const filename = `${randomToken(16)}.${ext}`;
    await this.storage.putBuffer(`avatars/${filename}`, file.buffer, file.mimetype);
    const base = (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:4300/api').replace(/\/+$/, '');
    const user = await this.users.setAvatarUrl(current.id, `${base}/users/avatars/${filename}`);
    return { user: UsersService.toPublic(user) };
  }

  // Public — so <img> tags can load avatars cross-origin. Served through the
  // API for both backends (local sendFile / S3 presigned redirect).
  @Get('avatars/:filename')
  async serveAvatar(@Param('filename') filename: string, @Res() res: Response) {
    const safe = path.basename(filename); // prevent path traversal
    // helmet() sets CORP: same-origin globally, which blocks the frontend
    // (different origin in dev) from loading this <img>. Relax it for avatars
    // only — they're public, non-sensitive static images.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    await this.storage.serve(res, `avatars/${safe}`);
  }
}
