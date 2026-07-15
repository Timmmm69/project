import { parseVerifiedStudentSessionConfig } from "@/server/auth/verified-student-session/config";
import { parseRecoveryConfig } from "@/server/recovery/config";

export type RecoveryUiAvailability =
  | Readonly<{ available: false }>
  | Readonly<{ available: true; productCode: string }>;

export function resolveRecoveryUiAvailability(
  environment: Record<string, string | undefined> = process.env
): RecoveryUiAvailability {
  try {
    const recovery = parseRecoveryConfig(environment);
    if (!recovery.enabled) return { available: false };

    const verifiedSession = parseVerifiedStudentSessionConfig(environment);
    if (verifiedSession.mode !== "enforce") return { available: false };

    return { available: true, productCode: recovery.productCode };
  } catch {
    return { available: false };
  }
}
