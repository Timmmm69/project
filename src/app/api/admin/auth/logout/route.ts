import { apiSuccess } from "@/lib/api-response";
import { clearAdminSessionCookie } from "@/server/auth/session";

export async function POST() {
  await clearAdminSessionCookie();
  return apiSuccess({ loggedOut: true });
}
