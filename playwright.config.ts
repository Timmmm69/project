import { defineConfig, devices } from "@playwright/test";

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
      SUPPORT_EMAIL: "support@example.test"
    }
  }
});
