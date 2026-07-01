import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

async function main() {
  const email = requireEnv("ADMIN_EMAIL").toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim();

  if (!password && !passwordHash) {
    throw new Error("Set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH to seed the first admin");
  }

  const hash = passwordHash || (await bcrypt.hash(password, 12));

  const admin = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      role: "ADMIN",
      passwordHash: hash
    },
    update: {
      role: "ADMIN",
      passwordHash: hash,
      deletedAt: null
    },
    select: {
      id: true,
      email: true,
      role: true
    }
  });

  console.log(`Seeded admin ${admin.email} (${admin.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
