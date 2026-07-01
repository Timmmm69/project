import { apiFailure, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/server/auth/session";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return apiFailure({ code: "UNAUTHORIZED", message: "Требуется вход в админку" }, 401);
  }

  return apiSuccess({
    user: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: "admin"
    }
  });
}
