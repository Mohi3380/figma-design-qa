import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamMemberDto, UpdateTeamMemberDto } from './dto/team.dto';

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService) {}

  // Public: only visible members, in display order.
  publicList() {
    return this.prisma.teamMember.findMany({
      where: { visible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, role: true, avatarUrl: true, linkedinUrl: true, xUrl: true },
    });
  }

  // Admin: every member (incl. hidden), in display order.
  adminList() {
    return this.prisma.teamMember.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreateTeamMemberDto) {
    // New members go to the end unless an explicit order is given.
    const sortOrder = dto.sortOrder ?? (await this.nextOrder());
    return this.prisma.teamMember.create({
      data: {
        name: dto.name,
        role: dto.role,
        avatarUrl: emptyToNull(dto.avatarUrl),
        linkedinUrl: emptyToNull(dto.linkedinUrl),
        xUrl: emptyToNull(dto.xUrl),
        visible: dto.visible ?? true,
        sortOrder,
      },
    });
  }

  async update(id: string, dto: UpdateTeamMemberDto) {
    await this.mustExist(id);
    return this.prisma.teamMember.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: emptyToNull(dto.avatarUrl) }),
        ...(dto.linkedinUrl !== undefined && { linkedinUrl: emptyToNull(dto.linkedinUrl) }),
        ...(dto.xUrl !== undefined && { xUrl: emptyToNull(dto.xUrl) }),
        ...(dto.visible !== undefined && { visible: dto.visible }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async remove(id: string) {
    await this.mustExist(id);
    await this.prisma.teamMember.delete({ where: { id } });
    return { ok: true };
  }

  // Persist a new ordering: sortOrder = position in the given id list.
  async reorder(ids: string[]) {
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.teamMember.update({ where: { id }, data: { sortOrder: i } })),
    );
    return this.adminList();
  }

  private async nextOrder(): Promise<number> {
    const last = await this.prisma.teamMember.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
    return (last?.sortOrder ?? -1) + 1;
  }

  private async mustExist(id: string): Promise<void> {
    const found = await this.prisma.teamMember.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Team member not found.');
  }
}

function emptyToNull(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}
