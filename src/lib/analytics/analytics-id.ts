import { createHmac } from "node:crypto";

export type AnalyticsIdEntity = "order" | "payment_attempt" | "access";

export type AnalyticsConfig = {
  enabled: boolean;
  hmacKey?: string;
  keyVersion?: string;
};

export function analyticsConfig(env: Record<string, string | undefined> = process.env): AnalyticsConfig {
  const enabled = env.ANALYTICS_ENABLED?.trim().toLowerCase() === "true";
  if (!enabled) return { enabled: false };
  const hmacKey = env.ANALYTICS_ID_HMAC_KEY?.trim();
  const keyVersion = env.ANALYTICS_ID_KEY_VERSION?.trim();
  if (!hmacKey || hmacKey.length < 32 || !keyVersion || !/^[A-Za-z0-9._-]{1,32}$/.test(keyVersion)) {
    throw new Error("ANALYTICS_CONFIGURATION_INVALID");
  }
  return { enabled: true, hmacKey, keyVersion };
}

/** Lower-case hexadecimal HMAC-SHA256 over a versioned, entity-scoped opaque ID. */
export function hashAnalyticsId(entity: AnalyticsIdEntity, opaquePublicId: string, config = analyticsConfig()) {
  if (!config.enabled || !config.hmacKey || !config.keyVersion) {
    throw new Error("ANALYTICS_CONFIGURATION_INVALID");
  }
  return createHmac("sha256", config.hmacKey)
    .update(`analytics-id\0${config.keyVersion}\0${entity}\0${opaquePublicId}`, "utf8")
    .digest("hex");
}
