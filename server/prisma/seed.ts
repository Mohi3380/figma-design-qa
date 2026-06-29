import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@koderlabs.local';
  const passwordHash = await bcrypt.hash('demo1234', 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Demo User',
      passwordHash,
      emailVerified: true,
    },
  });

  console.log(`Seeded demo user: ${user.email} (password: demo1234)`);

  // Seed the public team roster (idempotent) so admins have rows to edit and the
  // /team page isn't empty on a fresh DB. Mirrors the former hardcoded list.
  const TEAM = [
    'Founder & CEO',
    'Head of Engineering',
    'Design Lead',
    'QA Lead',
    'Frontend Engineer',
    'ML / Vision Engineer',
    'Product Manager',
    'DevOps Engineer',
  ];
  const existingTeam = await prisma.teamMember.count();
  if (existingTeam === 0) {
    await prisma.teamMember.createMany({
      data: TEAM.map((role, i) => ({ name: 'Team Member', role, sortOrder: i })),
    });
    console.log(`Seeded ${TEAM.length} placeholder team members`);
  } else {
    console.log(`Team roster already has ${existingTeam} member(s) — skipped`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
