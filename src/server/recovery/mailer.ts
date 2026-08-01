export type RecoveryMail = Readonly<{
  recipient: string;
  code: string;
  expiresAt: Date;
  correlationId: string;
}>;

export type RecoveryMailResult =
  | Readonly<{ status: "accepted" }>
  | Readonly<{ status: "failed"; safeCode: string }>
  | Readonly<{ status: "unknown"; safeCode: string }>;

export interface RecoveryMailer {
  sendVerificationCode(message: RecoveryMail): Promise<RecoveryMailResult>;
}

export const TEST_RECOVERY_MAILBOX_TTL_MS = 10 * 60 * 1000;

export type TestRecoveryMailbox = Readonly<{
  mailer: RecoveryMailer;
  pop(correlationId: string): RecoveryMail | null;
  clear(): void;
  cleanup(): number;
  size(): number;
}>;

export class RecoveryMailerEnvironmentError extends Error {
  constructor(readonly code: "TEST_MAILER_FORBIDDEN" | "FAKE_MAILER_FORBIDDEN" | "INSPECTION_HOOK_REQUIRED") {
    super(`RECOVERY_MAILER_ENVIRONMENT_INVALID:${code}`);
    this.name = "RecoveryMailerEnvironmentError";
  }
}

export function createTestRecoveryMailbox(input: {
  clock?: () => Date;
  ttlMs?: number;
  environment?: string;
} = {}): TestRecoveryMailbox {
  if ((input.environment ?? process.env.NODE_ENV) !== "test") {
    throw new RecoveryMailerEnvironmentError("TEST_MAILER_FORBIDDEN");
  }
  const clock = input.clock ?? (() => new Date());
  const ttlMs = input.ttlMs ?? TEST_RECOVERY_MAILBOX_TTL_MS;
  let sequence = 0;
  const messages: Array<{
    sequence: number;
    availableUntil: Date;
    message: RecoveryMail;
  }> = [];

  function cleanup() {
    const now = clock().getTime();
    let removed = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].availableUntil.getTime() <= now) {
        messages.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  }

  return {
    mailer: {
      async sendVerificationCode(message) {
        cleanup();
        const acceptedAt = clock();
        const availableUntil = new Date(Math.min(
          message.expiresAt.getTime(),
          acceptedAt.getTime() + ttlMs
        ));
        messages.push({
          sequence,
          availableUntil,
          message: { ...message, expiresAt: new Date(message.expiresAt) }
        });
        sequence += 1;
        return { status: "accepted" } as const;
      }
    },
    pop(correlationId) {
      cleanup();
      const index = messages
        .map((entry, currentIndex) => ({ entry, currentIndex }))
        .filter(({ entry }) => entry.message.correlationId === correlationId)
        .sort((left, right) => left.entry.sequence - right.entry.sequence)[0]?.currentIndex;
      if (index === undefined) {
        return null;
      }
      const [entry] = messages.splice(index, 1);
      return entry ? { ...entry.message, expiresAt: new Date(entry.message.expiresAt) } : null;
    },
    clear() {
      messages.splice(0, messages.length);
    },
    cleanup,
    size() {
      cleanup();
      return messages.length;
    }
  };
}

export function createFakeDevelopmentRecoveryMailer(input: {
  environment?: string;
  inspectionEnabled?: boolean;
  inspectionHook?: (message: RecoveryMail) => void | Promise<void>;
} = {}): RecoveryMailer {
  if ((input.environment ?? process.env.NODE_ENV) !== "development") {
    throw new RecoveryMailerEnvironmentError("FAKE_MAILER_FORBIDDEN");
  }
  if (input.inspectionEnabled && !input.inspectionHook) {
    throw new RecoveryMailerEnvironmentError("INSPECTION_HOOK_REQUIRED");
  }

  return {
    async sendVerificationCode(message) {
      if (input.inspectionEnabled) {
        await input.inspectionHook?.({ ...message, expiresAt: new Date(message.expiresAt) });
      }
      return { status: "accepted" };
    }
  };
}
