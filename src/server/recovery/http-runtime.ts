import type { RecoveryConfig } from "@/server/recovery/config";
import { parseRecoveryConfig } from "@/server/recovery/config";
import {
  createFakeDevelopmentRecoveryMailer,
  createTestRecoveryMailbox,
  type TestRecoveryMailbox
} from "@/server/recovery/mailer";
import { createRecoveryDomainService } from "@/server/recovery/service";
import { prisma } from "@/server/db/client";
import { canonicalRecoveryOrigin } from "@/server/recovery/request-protection";

export type RecoveryHttpService = Pick<
  ReturnType<typeof createRecoveryDomainService>,
  "requestChallenge" | "verifyChallenge" | "invalidateRecoverySession"
>;

export type EnabledRecoveryHttpRuntime = Readonly<{
  config: Extract<RecoveryConfig, { enabled: true }>;
  service: RecoveryHttpService;
  trustedOrigin: string;
  sourceLimiterInput: string;
}>;

export type RecoveryHttpRuntime =
  | Readonly<{ config: Extract<RecoveryConfig, { enabled: false }> }>
  | EnabledRecoveryHttpRuntime;

export class RecoveryHttpRuntimeError extends Error {
  constructor(readonly code: "TRUSTED_ORIGIN_MISSING" | "TRUSTED_ORIGIN_INVALID") {
    super(`RECOVERY_HTTP_RUNTIME_INVALID:${code}`);
    this.name = "RecoveryHttpRuntimeError";
  }
}

export const RECOVERY_HTTP_GLOBAL_SOURCE = "acc01a-recovery-http-global:v1";

let testMailbox: TestRecoveryMailbox | null = null;

export function createRecoveryHttpRuntime(
  environment: Record<string, string | undefined> = process.env
): RecoveryHttpRuntime {
  const config = parseRecoveryConfig(environment);
  if (!config.enabled) return { config };

  const rawAppUrl = environment.APP_URL;
  if (!rawAppUrl) throw new RecoveryHttpRuntimeError("TRUSTED_ORIGIN_MISSING");
  const trustedOrigin = canonicalRecoveryOrigin(rawAppUrl);
  if (!trustedOrigin) throw new RecoveryHttpRuntimeError("TRUSTED_ORIGIN_INVALID");

  const mailer = config.mailerMode === "fake"
    ? createFakeDevelopmentRecoveryMailer({ environment: environment.NODE_ENV })
    : (testMailbox ??= createTestRecoveryMailbox({ environment: environment.NODE_ENV })).mailer;

  return {
    config,
    trustedOrigin,
    sourceLimiterInput: RECOVERY_HTTP_GLOBAL_SOURCE,
    service: createRecoveryDomainService({
      client: prisma,
      config,
      mailer
    })
  };
}
