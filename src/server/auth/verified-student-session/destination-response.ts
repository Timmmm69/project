import type { NextResponse } from "next/server";
import { apiFailure } from "@/lib/api-response";
import type {
  VerifiedDestinationAuthorization,
  VerifiedStudentEntryResolution
} from "@/server/auth/verified-student-session/destination-guard";
import { clearRecoverySessionCookie } from "@/server/recovery/cookies";

const privateHeaders = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer"
});

type VerifiedEntryBlockedDecision = Extract<
  VerifiedStudentEntryResolution,
  { status: "BLOCKED" }
>;

function unsupportedBlockedReason(reason: never): never {
  throw new Error(`Unsupported verified entry blocked reason: ${String(reason)}`);
}

export function verifiedEntryBlockedResponse(decision: VerifiedEntryBlockedDecision) {
  const reason = decision.reason;
  switch (reason) {
    case "ACCESS_EXPIRED": {
      const response = apiFailure({
        code: "ACCESS_EXPIRED",
        message: "Attempt cannot be started for this access."
      }, 409);
      for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
      return response;
    }
    default:
      return unsupportedBlockedReason(reason);
  }
}

export function verifiedDestinationRejection(
  decision: Extract<VerifiedDestinationAuthorization, { status: "REJECTED" }>
) {
  const required = decision.code === "VERIFIED_SESSION_REQUIRED";
  const response = apiFailure({
    code: decision.code,
    message: required
      ? "Verified student session is required."
      : "Verified student session scope is not allowed."
  }, required ? 401 : 403);
  for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
  return response;
}

export function verifiedDestinationUnavailable() {
  const response = apiFailure({
    code: "VERIFIED_AUTHORIZATION_UNAVAILABLE",
    message: "Verified student authorization is temporarily unavailable."
  }, 503);
  for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
  return response;
}

export function finalizeVerifiedDestinationResponse<T extends NextResponse>(
  response: T,
  decision: VerifiedDestinationAuthorization
) {
  if (decision.status !== "AUTHORIZED") return response;
  for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
  if (decision.context.clearRecoveryCookie) clearRecoverySessionCookie(response);
  return response;
}
