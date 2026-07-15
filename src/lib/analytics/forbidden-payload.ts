import { assertAnalyticsPrivacy } from "@/lib/analytics/privacy-scan";

/** Compatibility name for existing callers; the implementation is the ANA-02A scanner. */
export function assertNoForbiddenAnalyticsPayload(value: unknown): void {
  assertAnalyticsPrivacy(value);
}

export { assertAnalyticsPrivacy, scanAnalyticsPrivacy } from "@/lib/analytics/privacy-scan";
