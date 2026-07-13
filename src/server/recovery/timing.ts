import { randomInt } from "node:crypto";

export const RECOVERY_MINIMUM_ELAPSED_MS = 300;
export const RECOVERY_MAXIMUM_JITTER_MS = 200;

export type RecoveryTimingDependencies = Readonly<{
  clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  randomJitterMs?: () => number;
}>;

export class RecoveryTimingError extends Error {
  constructor() {
    super("RECOVERY_TIMING_JITTER_INVALID");
    this.name = "RecoveryTimingError";
  }
}

export async function normalizeRecoveryTiming(
  startedAt: Date,
  dependencies: RecoveryTimingDependencies = {}
) {
  const clock = dependencies.clock ?? (() => new Date());
  const sleep = dependencies.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const jitter = (dependencies.randomJitterMs ?? (() => randomInt(0, RECOVERY_MAXIMUM_JITTER_MS + 1)))();
  if (!Number.isInteger(jitter) || jitter < 0 || jitter > RECOVERY_MAXIMUM_JITTER_MS) {
    throw new RecoveryTimingError();
  }

  const targetElapsedMs = RECOVERY_MINIMUM_ELAPSED_MS + jitter;
  const elapsedMs = Math.max(0, clock().getTime() - startedAt.getTime());
  const remainingMs = Math.max(0, targetElapsedMs - elapsedMs);
  if (remainingMs > 0) {
    await sleep(remainingMs);
  }
  return { targetElapsedMs, sleptMs: remainingMs } as const;
}
