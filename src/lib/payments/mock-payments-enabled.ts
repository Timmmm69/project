export function isMockPaymentsEnabled() {
  return process.env.NODE_ENV !== "production" && (
    process.env.ENABLE_MOCK_PAYMENTS === "true" || process.env.PAYMENT_PROVIDER === "mock"
  );
}
