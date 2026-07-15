import { defineConfig, devices } from "@playwright/test";

const recoveryUiE2eEnabled = process.env.RUN_ACC01A_RECOVERY_UI_E2E === "true";
const encodedRecoveryKey = (byte: number) => Buffer.alloc(32, byte).toString("base64url");
const recoveryUiEnvironment: Record<string, string> = recoveryUiE2eEnabled
  ? {
      APP_URL: "http://localhost:3000",
      ACC_01A_RECOVERY_ENABLED: "true",
      RECOVERY_MAILER_MODE: "fake",
      RECOVERY_COMMERCIAL_PRODUCT_CODE: "russian-training-variant-01",
      RECOVERY_EMAIL_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
      RECOVERY_EMAIL_FINGERPRINT_HMAC_KEY_RING: `v1:${encodedRecoveryKey(121)}`,
      RECOVERY_CHALLENGE_TOKEN_ACTIVE_KEY_VERSION: "v1",
      RECOVERY_CHALLENGE_TOKEN_HMAC_KEY_RING: `v1:${encodedRecoveryKey(122)}`,
      RECOVERY_OTP_ACTIVE_KEY_VERSION: "v1",
      RECOVERY_OTP_HMAC_KEY_RING: `v1:${encodedRecoveryKey(123)}`,
      RECOVERY_SESSION_TOKEN_ACTIVE_KEY_VERSION: "v1",
      RECOVERY_SESSION_TOKEN_HMAC_KEY_RING: `v1:${encodedRecoveryKey(124)}`,
      VERIFIED_COMMERCIAL_SESSION_MODE: "enforce",
      VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: "v1",
      VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: `v1:${encodedRecoveryKey(125)}`
    }
  : {};

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/russian_tests_mvp?schema=public",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "dev_session_secret_for_e2e_1234567890",
      ENABLE_MOCK_PAYMENTS: process.env.ENABLE_MOCK_PAYMENTS ?? "true",
      COMMERCIAL_CHECKOUT_ENABLED: "true",
      PAYMENTS_MODE: "webpay_sandbox",
      COMMERCIAL_FAKE_PROVIDER_TEST_ONLY: "true",
      COMMERCIAL_ORDER_TOKEN_HMAC_KEY: process.env.COMMERCIAL_ORDER_TOKEN_HMAC_KEY ?? "synthetic-e2e-commercial-order-token-key-32-bytes",
      LEGAL_BUNDLE_VERSION: "e2e-v1",
      OFFER_URL: "https://example.test/offer",
      PRIVACY_URL: "https://example.test/privacy",
      REFUND_POLICY_URL: "https://example.test/refund",
      DISCLAIMER_URL: "https://example.test/disclaimer",
      SUPPORT_EMAIL: "support@example.test",
      ...(process.env.VERIFIED_COMMERCIAL_SESSION_MODE
        ? { VERIFIED_COMMERCIAL_SESSION_MODE: process.env.VERIFIED_COMMERCIAL_SESSION_MODE }
        : {}),
      ...(process.env.VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION
        ? { VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION: process.env.VERIFIED_STUDENT_SESSION_ACTIVE_KEY_VERSION }
        : {}),
      ...(process.env.VERIFIED_STUDENT_SESSION_HMAC_KEY_RING
        ? { VERIFIED_STUDENT_SESSION_HMAC_KEY_RING: process.env.VERIFIED_STUDENT_SESSION_HMAC_KEY_RING }
        : {}),
      ...recoveryUiEnvironment
    }
  }
});
