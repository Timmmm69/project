import bcrypt from "bcryptjs";
import { z } from "zod";
import { apiFailure, apiSuccess } from "@/lib/api-response";
import { normalizedEmailSchema } from "@/lib/validation/email";
import { prisma } from "@/server/db/client";
import { setAdminSessionCookie } from "@/server/auth/session";

const loginSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(
      {
        code: "VALIDATION_ERROR",
        message: "Некорректные данные входа",
        details: parsed.error.flatten()
      },
      422
    );
  }

  const admin = await prisma.user.findFirst({
    where: {
      email: parsed.data.email,
      role: "ADMIN",
      deletedAt: null
    },
    select: {
      id: true,
      email: true,
      role: true,
      passwordHash: true
    }
  });

  if (!admin?.passwordHash) {
    return apiFailure({ code: "INVALID_CREDENTIALS", message: "Неверный email или пароль" }, 401);
  }

  const passwordMatches = await bcrypt.compare(parsed.data.password, admin.passwordHash);
  if (!passwordMatches) {
    return apiFailure({ code: "INVALID_CREDENTIALS", message: "Неверный email или пароль" }, 401);
  }

  await setAdminSessionCookie({
    userId: admin.id,
    email: admin.email,
    role: "ADMIN"
  });

  return apiSuccess({
    user: {
      id: admin.id,
      email: admin.email,
      role: "admin"
    }
  });
}
