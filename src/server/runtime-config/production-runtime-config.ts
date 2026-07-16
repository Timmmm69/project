import {
  parseVerifiedCommercialSessionMode,
  parseVerifiedStudentSessionConfig
} from "@/server/auth/verified-student-session/config";
import {
  classifyRuntimeEnvironment,
  type RuntimeEnvironment
} from "@/server/runtime-config/runtime-environment";

type EnvironmentMap = Readonly<Record<string, string | undefined>>;

export const PRODUCTION_RUNTIME_CONFIG_ISSUE_CODES = Object.freeze([
  "ENVIRONMENT_INVALID",
  "CORE_APP_ORIGIN_INVALID",
  "CORE_DATABASE_CONFIGURATION_INVALID",
  "CORE_SESSION_SECRET_INVALID",
  "CORE_ACCESS_CODE_PEPPER_INVALID",
  "CORE_SECRET_REUSE_FORBIDDEN",
  "CORE_PLAINTEXT_ADMIN_SECRET_FORBIDDEN",
  "UNSAFE_PAYMENT_TEST_MODE",
  "UNSAFE_COMMERCIAL_TEST_MODE",
  "UNSAFE_RECOVERY_MODE",
  "UNSAFE_TEST_EXECUTION_MODE",
  "VERIFIED_SESSION_CONFIGURATION_INVALID"
] as const);

export type ProductionRuntimeConfigIssueCode =
  (typeof PRODUCTION_RUNTIME_CONFIG_ISSUE_CODES)[number];

export type ProductionRuntimeConfigReport = Readonly<{
  environment: RuntimeEnvironment | null;
  status: "VALID" | "INVALID";
  issues: readonly ProductionRuntimeConfigIssueCode[];
}>;

const placeholderMarkers = Object.freeze([
  "change-me",
  "change_me",
  "changeme",
  "dev-only",
  "dev_only",
  "devonly",
  "example",
  "placeholder",
  "replace",
  "synthetic",
  "test-only",
  "test_only",
  "testonly"
] as const);

const verifiedSessionInputNames = Object.freeze([
  "NODE_ENV",
  "APP_ENV",
  "DEPLOYMENT_ENV",
  "VERCEL_ENV",
  "VERIFIED_COMMERCIAL_SESSION_MODE",
  "VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION",
  "VERIFIED_STUDENT_SESSION_HMAC_KEY_RING",
  "SESSION_SECRET",
  "ACCESS_CODE_HASH_PEPPER",
  "COMMERCIAL_ORDER_TOKEN_HMAC_KEY",
  "ORDER_TOKEN_HMAC_KEY",
  "RECOVERY_OTP_HMAC_KEY",
  "RECOVERY_OTP_HMAC_KEY_RING",
  "RECOVERY_CHALLENGE_TOKEN_HMAC_KEY",
  "RECOVERY_CHALLENGE_TOKEN_HMAC_KEY_RING",
  "RECOVERY_SESSION_TOKEN_HMAC_KEY",
  "RECOVERY_SESSION_TOKEN_HMAC_KEY_RING",
  "RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY",
  "RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING"
] as const);

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase();
}

function hasValue(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function isValidAppOrigin(value: string | undefined) {
  if (!hasValue(value)) {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

function isValidDatabaseConfiguration(value: string | undefined) {
  if (!hasValue(value)) {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "postgres:" || url.protocol === "postgresql:";
  } catch {
    return false;
  }
}

function isValidSecret(value: string | undefined) {
  if (!hasValue(value) || Buffer.byteLength(value, "utf8") < 32) {
    return false;
  }
  const normalizedValue = value.toLowerCase();
  return placeholderMarkers.every((marker) => !normalizedValue.includes(marker));
}

function secretsAreEqual(left: string | undefined, right: string | undefined) {
  if (!hasValue(left) || !hasValue(right)) {
    return false;
  }
  return Buffer.from(left, "utf8").equals(Buffer.from(right, "utf8"));
}

function selectedVerifiedSessionEnvironment(env: EnvironmentMap) {
  const selected: Record<string, string | undefined> = {};
  for (const name of verifiedSessionInputNames) {
    selected[name] = env[name];
  }
  return selected;
}

function verifiedSessionConfigurationIsValid(env: EnvironmentMap) {
  try {
    const mode = parseVerifiedCommercialSessionMode(env.VERIFIED_COMMERCIAL_SESSION_MODE);
    if (mode !== "off") {
      parseVerifiedStudentSessionConfig(selectedVerifiedSessionEnvironment(env));
    }
    return true;
  } catch {
    return false;
  }
}

function createReport(
  environment: RuntimeEnvironment | null,
  issueSet: ReadonlySet<ProductionRuntimeConfigIssueCode>
): ProductionRuntimeConfigReport {
  const issues = Object.freeze(
    PRODUCTION_RUNTIME_CONFIG_ISSUE_CODES.filter((issue) => issueSet.has(issue))
  );
  return Object.freeze({
    environment,
    status: issues.length === 0 ? "VALID" : "INVALID",
    issues
  });
}

export function validateProductionRuntimeConfig(env: EnvironmentMap): ProductionRuntimeConfigReport {
  const classification = classifyRuntimeEnvironment(env);
  if (classification.status === "INVALID") {
    return createReport(null, new Set(["ENVIRONMENT_INVALID"]));
  }

  const issues = new Set<ProductionRuntimeConfigIssueCode>();
  const productionLike = classification.environment === "staging" ||
    classification.environment === "production";

  if (productionLike) {
    if (!isValidAppOrigin(env.APP_URL)) {
      issues.add("CORE_APP_ORIGIN_INVALID");
    }
    if (!isValidDatabaseConfiguration(env.DATABASE_URL)) {
      issues.add("CORE_DATABASE_CONFIGURATION_INVALID");
    }
    if (!isValidSecret(env.SESSION_SECRET)) {
      issues.add("CORE_SESSION_SECRET_INVALID");
    }
    if (!isValidSecret(env.ACCESS_CODE_HASH_PEPPER)) {
      issues.add("CORE_ACCESS_CODE_PEPPER_INVALID");
    }
    if (secretsAreEqual(env.SESSION_SECRET, env.ACCESS_CODE_HASH_PEPPER)) {
      issues.add("CORE_SECRET_REUSE_FORBIDDEN");
    }
    if (hasValue(env.ADMIN_PASSWORD)) {
      issues.add("CORE_PLAINTEXT_ADMIN_SECRET_FORBIDDEN");
    }

    if (
      normalized(env.ENABLE_MOCK_PAYMENTS) === "true" ||
      normalized(env.PAYMENT_PROVIDER) === "mock" ||
      normalized(env.PAYMENTS_MODE) === "webpay_sandbox"
    ) {
      issues.add("UNSAFE_PAYMENT_TEST_MODE");
    }
    if (
      normalized(env.COMMERCIAL_FAKE_PROVIDER_TEST_ONLY) === "true" ||
      normalized(env.COMMERCIAL_CHECKOUT_ENABLED) === "true"
    ) {
      issues.add("UNSAFE_COMMERCIAL_TEST_MODE");
    }
    if (
      normalized(env.ACC_01A_RECOVERY_ENABLED) === "true" ||
      normalized(env.RECOVERY_MAILER_MODE) === "fake" ||
      normalized(env.RECOVERY_MAILER_MODE) === "test"
    ) {
      issues.add("UNSAFE_RECOVERY_MODE");
    }
    if (Object.keys(env).some((name) => (
      name.startsWith("RUN_") && normalized(env[name]) === "true"
    ))) {
      issues.add("UNSAFE_TEST_EXECUTION_MODE");
    }
  }

  if (!verifiedSessionConfigurationIsValid(env)) {
    issues.add("VERIFIED_SESSION_CONFIGURATION_INVALID");
  }

  return createReport(classification.environment, issues);
}
