import { normalizeEmail } from "@/lib/validation/email";
import { prisma } from "@/server/db/client";

export async function findOrCreateStudent(input: {
  email: string;
  name?: string;
}) {
  const email = normalizeEmail(input.email);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      deletedAt: true
    }
  });

  if (existing && (existing.role !== "STUDENT" || existing.deletedAt)) {
    throw new Error("EMAIL_NOT_AVAILABLE");
  }

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      email,
      name: input.name,
      role: "STUDENT"
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      deletedAt: true
    }
  });
}
