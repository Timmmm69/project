import { describe, expect, it } from "vitest";
import {
  PRODUCTION_RUNTIME_CONFIG_ISSUE_CODES,
  validateProductionRuntimeConfig,
  type ProductionRuntimeConfigIssueCode
} from "@/server/runtime-config/production-runtime-config";
import { classifyRuntimeEnvironment } from "@/server/runtime-config/runtime-environment";

function encodedBytes(seed: number) {
  return Buffer.from(Array.from({ length: 32 }, (_, index) => (
    (seed + index * 29) % 256
  ))).toString("base64url");
}

function validProductionEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    APP_ENV: "production",
    APP_URL: "https://runtime-origin.invalid",
    DATABASE_URL: "postgresql://runtime-database.invalid/runtime_contract",
    SESSION_SECRET: encodedBytes(17),
    ACCESS_CODE_HASH_PEPPER: encodedBytes(83),
    ...overrides
  };
}

function expectIssue(
  overrides: Record<string, string | undefined>,
  issue: ProductionRuntimeConfigIssueCode
) {
  const report = validateProductionRuntimeConfig(validProductionEnvironment(overrides));
  expect(report.status).toBe("INVALID");
  expect(report.issues).toContain(issue);
  return report;
}

function verifiedSessionEnvironment(mode: "shadow" | "enforce") {
  return validProductionEnvironment({
    VERIFIED_COMMERCIAL_SESSION_MODE: mode,
    VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "runtime_v1",
    VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `runtime_v1:${encodedBytes(149)}`
  });
}

describe("runtime environment classification", () => {
  it("classifies development execution and deployment aliases", () => {
    expect(classifyRuntimeEnvironment({ NODE_ENV: "development" })).toEqual({
      status: "VALID",
      environment: "development"
    });
    expect(classifyRuntimeEnvironment({ NODE_ENV: "dev", APP_ENV: "development" })).toEqual({
      status: "VALID",
      environment: "development"
    });
  });

  it("classifies the test environment", () => {
    expect(classifyRuntimeEnvironment({ NODE_ENV: "test", DEPLOYMENT_ENV: "test" })).toEqual({
      status: "VALID",
      environment: "test"
    });
  });

  it.each(["preview", "stage", "staging"])("classifies %s as staging", (label) => {
    expect(classifyRuntimeEnvironment({ NODE_ENV: "production", VERCEL_ENV: label })).toEqual({
      status: "VALID",
      environment: "staging"
    });
  });

  it.each(["prod", "production"])("classifies %s as production", (label) => {
    expect(classifyRuntimeEnvironment({ NODE_ENV: "production", APP_ENV: label })).toEqual({
      status: "VALID",
      environment: "production"
    });
  });

  it("infers production from NODE_ENV when deployment labels are absent", () => {
    expect(classifyRuntimeEnvironment({ NODE_ENV: "prod" })).toEqual({
      status: "VALID",
      environment: "production"
    });
  });

  it("fails closed for conflicting canonical deployment labels", () => {
    expect(classifyRuntimeEnvironment({
      NODE_ENV: "production",
      APP_ENV: "staging",
      DEPLOYMENT_ENV: "production"
    })).toEqual({ status: "INVALID", environment: null });
  });

  it("fails closed for an unknown non-empty label without echoing it", () => {
    const classification = classifyRuntimeEnvironment({
      NODE_ENV: "production",
      APP_ENV: "unapproved-runtime-label"
    });
    expect(classification).toEqual({ status: "INVALID", environment: null });
    expect(JSON.stringify(classification)).not.toContain("unapproved-runtime-label");
  });

  it("fails closed for an incompatible execution/deployment combination", () => {
    expect(classifyRuntimeEnvironment({ NODE_ENV: "test", APP_ENV: "staging" })).toEqual({
      status: "INVALID",
      environment: null
    });
  });
});

describe("production runtime configuration", () => {
  it("accepts a valid HTTPS root origin in staging and production", () => {
    const production = validateProductionRuntimeConfig(validProductionEnvironment());
    const staging = validateProductionRuntimeConfig(validProductionEnvironment({ APP_ENV: "preview" }));
    expect(production).toEqual({ environment: "production", status: "VALID", issues: [] });
    expect(staging).toEqual({ environment: "staging", status: "VALID", issues: [] });
  });

  it.each(["staging", "production"] as const)("rejects HTTP in %s", (environment) => {
    expectIssue({
      APP_ENV: environment,
      APP_URL: "http://runtime-origin.invalid"
    }, "CORE_APP_ORIGIN_INVALID");
  });

  it("allows localhost HTTP only outside the production-like contract", () => {
    expect(validateProductionRuntimeConfig({
      NODE_ENV: "development",
      APP_ENV: "development",
      APP_URL: "http://localhost:3000"
    })).toEqual({ environment: "development", status: "VALID", issues: [] });
    expect(validateProductionRuntimeConfig({
      NODE_ENV: "test",
      APP_ENV: "test",
      APP_URL: "http://localhost:3000"
    })).toEqual({ environment: "test", status: "VALID", issues: [] });
  });

  it.each([
    "https://runtime-user:runtime-pass@runtime-origin.invalid/",
    "https://runtime-origin.invalid/?mode=unsafe",
    "https://runtime-origin.invalid/#unsafe",
    "https://runtime-origin.invalid/nested"
  ])("rejects a non-origin APP_URL shape", (value) => {
    expectIssue({ APP_URL: value }, "CORE_APP_ORIGIN_INVALID");
  });

  it.each(["postgres:", "postgresql:"])("accepts the %s database protocol", (protocol) => {
    const report = validateProductionRuntimeConfig(validProductionEnvironment({
      DATABASE_URL: `${protocol}//runtime-database.invalid/runtime_contract`
    }));
    expect(report.status).toBe("VALID");
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expectIssue({
      DATABASE_URL: "mysql://runtime-database.invalid/runtime_contract"
    }, "CORE_DATABASE_CONFIGURATION_INVALID");
  });

  it("reports every missing core value with closed issue codes", () => {
    const report = validateProductionRuntimeConfig(validProductionEnvironment({
      APP_URL: undefined,
      DATABASE_URL: undefined,
      SESSION_SECRET: undefined,
      ACCESS_CODE_HASH_PEPPER: undefined
    }));
    expect(report.issues).toEqual([
      "CORE_APP_ORIGIN_INVALID",
      "CORE_DATABASE_CONFIGURATION_INVALID",
      "CORE_SESSION_SECRET_INVALID",
      "CORE_ACCESS_CODE_PEPPER_INVALID"
    ]);
  });

  it("rejects secrets shorter than 32 UTF-8 bytes", () => {
    const report = validateProductionRuntimeConfig(validProductionEnvironment({
      SESSION_SECRET: "short-runtime-secret",
      ACCESS_CODE_HASH_PEPPER: "short-runtime-pepper"
    }));
    expect(report.issues).toEqual([
      "CORE_SESSION_SECRET_INVALID",
      "CORE_ACCESS_CODE_PEPPER_INVALID"
    ]);
  });

  it.each(["change-me", "DEV_ONLY", "example", "placeholder", "replace", "synthetic", "TEST_ONLY"])(
    "rejects the closed placeholder marker %s",
    (marker) => {
      const value = `${encodedBytes(201)}-${marker}`;
      const report = validateProductionRuntimeConfig(validProductionEnvironment({
        SESSION_SECRET: value,
        ACCESS_CODE_HASH_PEPPER: value.replace(marker, "safe-runtime-value")
      }));
      expect(report.issues).toContain("CORE_SESSION_SECRET_INVALID");
    }
  );

  it("rejects byte-equal session and access-code secrets", () => {
    const reused = encodedBytes(231);
    expectIssue({
      SESSION_SECRET: reused,
      ACCESS_CODE_HASH_PEPPER: reused
    }, "CORE_SECRET_REUSE_FORBIDDEN");
  });

  it("rejects a non-empty plaintext admin password", () => {
    expectIssue({ ADMIN_PASSWORD: "runtime-admin-plaintext" }, "CORE_PLAINTEXT_ADMIN_SECRET_FORBIDDEN");
  });

  it.each([
    { ENABLE_MOCK_PAYMENTS: "true" },
    { PAYMENT_PROVIDER: "mock" }
  ])("rejects mock payment activation", (overrides) => {
    expectIssue(overrides, "UNSAFE_PAYMENT_TEST_MODE");
  });

  it("rejects the local fake commercial provider flag", () => {
    expectIssue({ COMMERCIAL_FAKE_PROVIDER_TEST_ONLY: "true" }, "UNSAFE_COMMERCIAL_TEST_MODE");
  });

  it("rejects sandbox checkout activation", () => {
    const report = validateProductionRuntimeConfig(validProductionEnvironment({
      COMMERCIAL_CHECKOUT_ENABLED: "true",
      PAYMENTS_MODE: "webpay_sandbox"
    }));
    expect(report.issues).toContain("UNSAFE_PAYMENT_TEST_MODE");
    expect(report.issues).toContain("UNSAFE_COMMERCIAL_TEST_MODE");
  });

  it("rejects recovery activation", () => {
    expectIssue({ ACC_01A_RECOVERY_ENABLED: "true" }, "UNSAFE_RECOVERY_MODE");
  });

  it.each(["fake", "test"])("rejects the %s recovery mailer", (mode) => {
    expectIssue({ RECOVERY_MAILER_MODE: mode }, "UNSAFE_RECOVERY_MODE");
  });

  it("rejects any exact RUN_ prefix whose normalized value is true", () => {
    const report = expectIssue({
      RUN_RUNTIME_BOUNDARY_FIXTURE: " TRUE ",
      NOT_RUN_RUNTIME_BOUNDARY_FIXTURE: "true"
    }, "UNSAFE_TEST_EXECUTION_MODE");
    expect(report.issues.filter((issue) => issue === "UNSAFE_TEST_EXECUTION_MODE")).toHaveLength(1);
  });

  it("rejects an invalid verified-session mode with one safe issue", () => {
    const report = expectIssue({
      VERIFIED_COMMERCIAL_SESSION_MODE: "enabled"
    }, "VERIFIED_SESSION_CONFIGURATION_INVALID");
    expect(JSON.stringify(report)).not.toContain("enabled");
  });

  it.each(["shadow", "enforce"] as const)(
    "accepts a valid non-placeholder verified-session key ring in %s mode",
    (mode) => {
      expect(validateProductionRuntimeConfig(verifiedSessionEnvironment(mode))).toEqual({
        environment: "production",
        status: "VALID",
        issues: []
      });
    }
  );

  it.each(["shadow", "enforce"] as const)(
    "rejects malformed and placeholder verified-session material in %s mode",
    (mode) => {
      const malformed = validateProductionRuntimeConfig(validProductionEnvironment({
        VERIFIED_COMMERCIAL_SESSION_MODE: mode,
        VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "runtime_v1",
        VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: "runtime_v1:not+base64"
      }));
      const placeholder = Buffer.from(
        "placeholder-verified-runtime-key-material",
        "utf8"
      ).toString("base64url");
      const placeholderReport = validateProductionRuntimeConfig(validProductionEnvironment({
        VERIFIED_COMMERCIAL_SESSION_MODE: mode,
        VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "runtime_v1",
        VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `runtime_v1:${placeholder}`
      }));
      expect(malformed.issues).toEqual(["VERIFIED_SESSION_CONFIGURATION_INVALID"]);
      expect(placeholderReport.issues).toEqual(["VERIFIED_SESSION_CONFIGURATION_INVALID"]);
    }
  );

  it("allows off mode without parsing an unrelated key ring", () => {
    expect(validateProductionRuntimeConfig(validProductionEnvironment({
      VERIFIED_COMMERCIAL_SESSION_MODE: "off",
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: "not-a-runtime-key-ring"
    })).status).toBe("VALID");
  });

  it("returns deterministic issue order independent of input key order", () => {
    const invalidValues = {
      RUN_RUNTIME_BOUNDARY_FIXTURE: "true",
      RECOVERY_MAILER_MODE: "test",
      COMMERCIAL_FAKE_PROVIDER_TEST_ONLY: "true",
      ENABLE_MOCK_PAYMENTS: "true",
      ADMIN_PASSWORD: "runtime-admin-plaintext",
      ACCESS_CODE_HASH_PEPPER: "change-me-runtime-pepper",
      SESSION_SECRET: "change-me-runtime-secret",
      DATABASE_URL: "mysql://runtime-database.invalid/runtime_contract",
      APP_URL: "http://runtime-origin.invalid",
      VERIFIED_COMMERCIAL_SESSION_MODE: "invalid-mode"
    };
    const first = validateProductionRuntimeConfig(validProductionEnvironment(invalidValues));
    const reversed = validateProductionRuntimeConfig(validProductionEnvironment(
      Object.fromEntries(Object.entries(invalidValues).reverse())
    ));
    expect(first.issues).toEqual(reversed.issues);
    expect(first.issues).toEqual(PRODUCTION_RUNTIME_CONFIG_ISSUE_CODES.filter((issue) => (
      first.issues.includes(issue)
    )));
  });

  it("never returns duplicate issue codes", () => {
    const report = validateProductionRuntimeConfig(validProductionEnvironment({
      ENABLE_MOCK_PAYMENTS: "true",
      PAYMENT_PROVIDER: "mock",
      PAYMENTS_MODE: "webpay_sandbox",
      COMMERCIAL_FAKE_PROVIDER_TEST_ONLY: "true",
      COMMERCIAL_CHECKOUT_ENABLED: "true",
      ACC_01A_RECOVERY_ENABLED: "true",
      RECOVERY_MAILER_MODE: "test",
      RUN_FIRST_FIXTURE: "true",
      RUN_SECOND_FIXTURE: "true"
    }));
    expect(new Set(report.issues).size).toBe(report.issues.length);
  });

  it("returns an immutable closed report", () => {
    const report = validateProductionRuntimeConfig(validProductionEnvironment());
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.issues)).toBe(true);
    expect(Object.keys(report).sort()).toEqual(["environment", "issues", "status"]);
  });

  it("does not echo raw values or environment variable names", () => {
    const rawValues = {
      APP_URL: "http://private-runtime-host.invalid/private?opaque=value#fragment",
      DATABASE_URL: "mysql://private-runtime-database.invalid/private_runtime",
      SESSION_SECRET: "private-runtime-session-material",
      ACCESS_CODE_HASH_PEPPER: "private-runtime-pepper-material",
      ADMIN_PASSWORD: "private-runtime-admin-material",
      VERIFIED_COMMERCIAL_SESSION_MODE: "private-runtime-mode"
    };
    const serialized = JSON.stringify(validateProductionRuntimeConfig(
      validProductionEnvironment(rawValues)
    ));
    for (const [name, value] of Object.entries(rawValues)) {
      expect(serialized).not.toContain(name);
      expect(serialized).not.toContain(value);
    }
  });

  it("does not let analytics variables affect the report", () => {
    const env = verifiedSessionEnvironment("enforce");
    const withoutAnalytics = validateProductionRuntimeConfig(env);
    const withAnalytics = validateProductionRuntimeConfig({
      ...env,
      ANALYTICS_ENABLED: "true",
      ANALYTICS_ID_HMAC_KEY: encodedBytes(149),
      ANALYTICS_ID_KEY_VERSION: "analytics_runtime_v1"
    });
    expect(withAnalytics).toEqual(withoutAnalytics);
  });

  it("does not mutate the input environment object", () => {
    const env = Object.freeze(validProductionEnvironment({
      VERIFIED_COMMERCIAL_SESSION_MODE: "off"
    }));
    const snapshot = { ...env };
    expect(() => validateProductionRuntimeConfig(env)).not.toThrow();
    expect(env).toEqual(snapshot);
  });
});
