import type { RecoveryConfig } from "@/server/recovery/config";
import { parseRecoveryConfig } from "@/server/recovery/config";
import {
  createFakeDevelopmentRecoveryMailer,
  createTestRecoveryMailbox,
  type TestRecoveryMailbox
} from "@/server/recovery/mailer";
import { createRecoveryDomainService } from "@/server/recovery/service";
import { prisma } from "@/server/db/client";

export type RecoveryHttpService = Pick<
  ReturnType<typeof createRecoveryDomainService>,
  "requestChallenge" | "verifyChallenge" | "invalidateRecoverySession"
>;

export type RecoveryHttpRuntime = Readonly<{
  config: RecoveryConfig;
  service?: RecoveryHttpService;
}>;

let testMailbox: TestRecoveryMailbox | null = null;

export function createRecoveryHttpRuntime(): RecoveryHttpRuntime {
  const config = parseRecoveryConfig();
  if (!config.enabled) return { config };

  const mailer = config.mailerMode === "fake"
    ? createFakeDevelopmentRecoveryMailer({ environment: process.env.NODE_ENV })
    : (testMailbox ??= createTestRecoveryMailbox({ environment: process.env.NODE_ENV })).mailer;

  return {
    config,
    service: createRecoveryDomainService({
      client: prisma,
      config,
      mailer
    })
  };
}
