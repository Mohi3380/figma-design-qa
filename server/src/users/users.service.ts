import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { PublicUserDto } from './dto/public-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByGoogleId(googleId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { googleId } });
  }

  create(data: {
    email: string;
    name?: string;
    passwordHash?: string;
    googleId?: string;
    emailVerified?: boolean;
    avatarUrl?: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: { ...data, email: data.email.toLowerCase() },
    });
  }

  updateName(id: string, name: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { name } });
  }

  setAvatarUrl(id: string, avatarUrl: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { avatarUrl } });
  }

  /** Public-safe view — a strict whitelist (see PublicUserDto). Anything not
   * explicitly exposed there is dropped, so new sensitive columns can't leak. */
  static toPublic(user: User): PublicUserDto {
    return plainToInstance(PublicUserDto, user, { excludeExtraneousValues: true });
  }
}
