import { apiSuccess } from "@/lib/api-response";

export function GET() {
  return apiSuccess({
    service: "ce-ct-online-tests-mvp",
    status: "ok"
  });
}
