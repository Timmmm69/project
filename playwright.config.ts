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
        process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/ce_ct_tests_dev?schema=public",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "dev_session_secret_for_e2e_1234567890",
      ENABLE_MOCK_PAYMENTS: process.env.ENABLE_MOCK_PAYMENTS ?? "true"
    }
  }
});
