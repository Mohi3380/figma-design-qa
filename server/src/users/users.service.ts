import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

  /** Public-safe view (no password hash). */
  static toPublic(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };
  }
}
