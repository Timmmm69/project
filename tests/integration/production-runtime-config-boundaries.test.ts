import { describe, expect, it } from "vitest";
import { isLocalFakeCommercialProviderEnabled } from "@/lib/commercial/providers";
import { isMockPaymentsEnabled } from "@/lib/payments/mock-payments-enabled";
import {
  parseVerifiedStudentSessionConfig,
  VerifiedStudentSessionConfigError
} from "@/server/auth/verified-student-session/config";
import {
  parseRecoveryConfig,
  RecoveryConfigError
} from "@/server/recovery/config";
import { validateProductionRuntimeConfig } from "@/server/runtime-config/production-runtime-config";

function encodedBytes(seed: number) {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => (
    (seed + index * 31) % 256
  ))).toString("base64url");
}

function productionEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_URL: "https://runtime-boundary.invalid",
    DATABASE_URL: "postgresql://runtime-boundary-database.invalid/runtime_boundary",
    SESSION_SECRET: encodedBytes(23),
    ACCESS_CODE_HASH_PEPPER: encodedBytes(101),
    ...overrides
  };
}

function verifiedEnvironment(mode: "shadow" | "enforce") {
  return productionEnvironment({
    VERIFIED_COMMERCIAL_SESSION_MODE: mode,
    VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "boundary_v1",
    VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `boundary_v1:${encodedBytes(173)}`
  });
}

function withProcessEnvironment<T>(
  overrides: Readonly<Record<string, string | undefined>>,
  callback: () => T
): T {
  const previous = new Map<string, { existed: boolean; value: string | undefined }>();
  for (const name of Object.keys(overrides)) {
    previous.set(name, {
      existed: Object.prototype.hasOwnProperty.call(process.env, name),
      value: process.env[name]
    });
  }

  try {
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    return callback();
  } finally {
    for (const [name, state] of previous) {
      if (state.existed && state.value !== undefined) {
        process.env[name] = state.value;
      } else {
        delete process.env[name];
      }
    }
  }
}

describe("production runtime configuration boundaries", () => {
  it("rejects ENABLE_MOCK_PAYMENTS while the existing production guard stays disabled", () => {
    const report = validateProductionRuntimeConfig(productionEnvironment({
      ENABLE_MOCK_PAYMENTS: "true"
    }));
    expect(report.issues).toContain("UNSAFE_PAYMENT_TEST_MODE");

    withProcessEnvironment({
      NODE_ENV: "production",
      ENABLE_MOCK_PAYMENTS: "true",
      PAYMENT_PROVIDER: undefined
    }, () => {
      expect(isMockPaymentsEnabled()).toBe(false);
    });
  });

  it("rejects PAYMENT_PROVIDER=mock while the existing production guard stays disabled", () => {
    const report = validateProductionRuntimeConfig(productionEnvironment({
      PAYMENT_PROVIDER: "mock"
    }));
    expect(report.issues).toContain("UNSAFE_PAYMENT_TEST_MODE");

    withProcessEnvironment({
      NODE_ENV: "production",
      ENABLE_MOCK_PAYMENTS: undefined,
      PAYMENT_PROVIDER: "mock"
    }, () => {
      expect(isMockPaymentsEnabled()).toBe(false);
    });
  });

  it("rejects the fake commercial flag while the existing production guard stays disabled", () => {
    const report = validateProductionRuntimeConfig(productionEnvironment({
      COMMERCIAL_FAKE_PROVIDER_TEST_ONLY: "true"
    }));
    expect(report.issues).toContain("UNSAFE_COMMERCIAL_TEST_MODE");

    withProcessEnvironment({
      NODE_ENV: "production",
      COMMERCIAL_FAKE_PROVIDER_TEST_ONLY: "true"
    }, () => {
      expect(isLocalFakeCommercialProviderEnabled()).toBe(false);
    });
  });

  it.each(["production", "staging"] as const)(
    "rejects recovery activation in %s through both contracts",
    (environment) => {
      const env = productionEnvironment({
        APP_ENV: environment,
        ACC_01A_RECOVERY_ENABLED: "true",
        RECOVERY_MAILER_MODE: "test",
        RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING: "private-boundary-recovery-material"
      });
      const report = validateProductionRuntimeConfig(env);
      expect(report.issues).toContain("UNSAFE_RECOVERY_MODE");
      expect(JSON.stringify(report)).not.toContain("RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING");
      expect(JSON.stringify(report)).not.toContain("private-boundary-recovery-material");

      try {
        parseRecoveryConfig(env);
        throw new Error("EXPECTED_RECOVERY_CONFIG_ERROR");
      } catch (error) {
        expect(error).toBeInstanceOf(RecoveryConfigError);
        expect((error as RecoveryConfigError).code).toBe("PRODUCTION_LIKE_FORBIDDEN");
        expect(String(error)).not.toContain("RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING");
        expect(String(error)).not.toContain("private-boundary-recovery-material");
      }
    }
  );

  it("keeps disabled recovery valid without recovery key material", () => {
    const env = productionEnvironment({ ACC_01A_RECOVERY_ENABLED: "false" });
    expect(validateProductionRuntimeConfig(env)).toEqual({
      environment: "production",
      status: "VALID",
      issues: []
    });
    expect(parseRecoveryConfig(env)).toEqual({ enabled: false });
  });

  it.each(["shadow", "enforce"] as const)(
    "uses the existing verified-session parser for valid %s configuration",
    (mode) => {
      const env = verifiedEnvironment(mode);
      expect(parseVerifiedStudentSessionConfig(env).mode).toBe(mode);
      expect(validateProductionRuntimeConfig(env)).toEqual({
        environment: "production",
        status: "VALID",
        issues: []
      });
    }
  );

  it.each(["shadow", "enforce"] as const)(
    "maps invalid %s key material to one safe verified-session issue",
    (mode) => {
      const rawKeyRing = "boundary_v1:not+base64";
      const env = productionEnvironment({
        VERIFIED_COMMERCIAL_SESSION_MODE: mode,
        VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "boundary_v1",
        VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: rawKeyRing
      });
      expect(() => parseVerifiedStudentSessionConfig(env)).toThrowError(
        expect.objectContaining<Partial<VerifiedStudentSessionConfigError>>({
          code: "KEY_RING_MALFORMED"
        })
      );
      const report = validateProductionRuntimeConfig(env);
      expect(report.issues).toEqual(["VERIFIED_SESSION_CONFIGURATION_INVALID"]);
      expect(JSON.stringify(report)).not.toContain(rawKeyRing);
      expect(JSON.stringify(report)).not.toContain("KEY_RING_MALFORMED");
    }
  );

  it("restores every temporary global environment change", () => {
    const previousNodeEnvironment = process.env.NODE_ENV;
    const previousMockFlag = process.env.ENABLE_MOCK_PAYMENTS;
    withProcessEnvironment({
      NODE_ENV: "production",
      ENABLE_MOCK_PAYMENTS: "true"
    }, () => {
      expect(process.env.NODE_ENV).toBe("production");
      expect(process.env.ENABLE_MOCK_PAYMENTS).toBe("true");
    });
    expect(process.env.NODE_ENV).toBe(previousNodeEnvironment);
    expect(process.env.ENABLE_MOCK_PAYMENTS).toBe(previousMockFlag);
  });
});
