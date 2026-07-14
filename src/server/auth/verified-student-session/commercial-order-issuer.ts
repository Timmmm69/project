import type { PrismaClient } from "@prisma/client";
import type { NextResponse } from "next/server";
import {
  parseVerifiedCommercialSessionMode,
  parseVerifiedStudentSessionConfig,
  type VerifiedCommercialSessionMode,
  type VerifiedStudentSessionConfig
} from "@/server/auth/verified-student-session/config";
import { setVerifiedStudentSessionCookie } from "@/server/auth/verified-student-session/cookies";
import { isAuthenticRikzRussianExamMode } from "@/server/auth/verified-student-session/exam-mode";
import {
  createVerifiedStudentSessionService,
  type IssueVerifiedStudentSessionInput,
  type IssueVerifiedStudentSessionResult,
  VerifiedStudentSessionServiceError
} from "@/server/auth/verified-student-session/service";
import { prisma } from "@/server/db/client";

export type CommercialOrderSessionClaim = Readonly<{
  orderId: string;
  examMode: string;
  student: Readonly<{ userId: string; email: string; role: "STUDENT" }>;
  commercialProductId: string;
  testId: string;
  accessId: string;
}>;

export type CommercialOrderSessionIssuance =
  | Readonly<{
      status: "LEGACY";
      mode: VerifiedCommercialSessionMode;
      reason: "MODE_OFF" | "GENERIC_TEST" | "SHADOW_ISSUANCE_UNAVAILABLE";
    }>
  | Readonly<{
      status: "ISSUED";
      mode: "shadow" | "enforce";
      result: IssueVerifiedStudentSessionResult;
    }>
  | Readonly<{
      status: "SCOPE_NOT_ALLOWED";
      mode: "enforce";
    }>
  | Readonly<{
      status: "UNAVAILABLE";
      mode: "enforce" | null;
    }>;

export type CommercialOrderSessionIssuerDependencies = Readonly<{
  client?: PrismaClient;
  environment?: Record<string, string | undefined>;
  config?: VerifiedStudentSessionConfig;
  clock?: () => Date;
  issueSession?: (
    input: IssueVerifiedStudentSessionInput
  ) => Promise<IssueVerifiedStudentSessionResult>;
}>;

const privateHeaders = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer"
});

function serviceErrorIsScopeFailure(error: VerifiedStudentSessionServiceError) {
  return error.code === "SUBJECT_INVALID" ||
    error.code === "ACCESS_REVOKED" ||
    error.code === "ACCESS_EXPIRED" ||
    error.code === "SCOPE_MISMATCH";
}

export async function issueCommercialOrderVerifiedSession(
  claim: CommercialOrderSessionClaim,
  issuanceOperationId: string,
  dependencies: CommercialOrderSessionIssuerDependencies = {}
): Promise<CommercialOrderSessionIssuance> {
  const environment = dependencies.environment ?? process.env;
  let mode: VerifiedCommercialSessionMode;
  try {
    mode = dependencies.config?.mode ??
      parseVerifiedCommercialSessionMode(environment.VERIFIED_COMMERCIAL_SESSION_MODE);
  } catch {
    return { status: "UNAVAILABLE", mode: null };
  }

  if (!isAuthenticRikzRussianExamMode(claim.examMode, "CURRENT_TEST")) {
    return { status: "LEGACY", mode, reason: "GENERIC_TEST" };
  }
  if (mode === "off") {
    return { status: "LEGACY", mode, reason: "MODE_OFF" };
  }

  try {
    const config = dependencies.config ?? parseVerifiedStudentSessionConfig(environment);
    const issueSession = dependencies.issueSession ??
      createVerifiedStudentSessionService({
        client: dependencies.client ?? prisma,
        config,
        clock: dependencies.clock
      }).issue;
    const result = await issueSession({
      source: "COMMERCIAL_ORDER_CLAIM",
      sourceReferenceId: claim.orderId,
      issuanceOperationId,
      userId: claim.student.userId,
      commercialProductId: claim.commercialProductId,
      testId: claim.testId,
      accessId: claim.accessId
    });
    return { status: "ISSUED", mode, result };
  } catch (error) {
    if (mode === "shadow") {
      return { status: "LEGACY", mode, reason: "SHADOW_ISSUANCE_UNAVAILABLE" };
    }
    if (error instanceof VerifiedStudentSessionServiceError && serviceErrorIsScopeFailure(error)) {
      return { status: "SCOPE_NOT_ALLOWED", mode };
    }
    return { status: "UNAVAILABLE", mode };
  }
}

export function commercialOrderIssuanceUsesLegacySession(
  issuance: CommercialOrderSessionIssuance
) {
  return issuance.status === "LEGACY" ||
    issuance.status === "ISSUED" && issuance.mode === "shadow";
}

export function finalizeCommercialOrderSessionResponse<T extends NextResponse>(
  response: T,
  issuance: CommercialOrderSessionIssuance
) {
  if (issuance.status !== "ISSUED") return response;
  for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
  setVerifiedStudentSessionCookie(
    response,
    issuance.result.rawToken,
    issuance.result.expiresAt
  );
  return response;
}
