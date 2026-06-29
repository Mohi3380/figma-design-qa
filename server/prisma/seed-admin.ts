import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@koderlabs.local';
  const passwordHash = await bcrypt.hash('admin1234', 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', emailVerified: true },
    create: {
      email,
      name: 'Admin User',
      passwordHash,
      role: 'ADMIN',
      emailVerified: true,
    },
  });

  console.log(`Seeded admin user: ${user.email} (role: ${user.role}, password: admin1234)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
