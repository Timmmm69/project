import { createHmac } from "node:crypto";

export const ANALYTICS_ENTITY_ID_PATTERN = /^aid1\.[A-Za-z0-9_-]{43}$/;
export const ANALYTICS_ID_KEY_VERSION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const ANALYTICS_ENTITY_NAMESPACES = ["order", "payment_attempt", "access", "attempt"] as const;
export type AnalyticsEntityNamespace = (typeof ANALYTICS_ENTITY_NAMESPACES)[number];

export type AnalyticsEntityIdKeyRing = ReadonlyMap<string, Uint8Array>;

export type AnalyticsEntityIdErrorCode =
  | "INVALID_ENTITY_NAMESPACE"
  | "INVALID_PUBLIC_ID"
  | "EMAIL_SOURCE_FORBIDDEN"
  | "INVALID_KEY_VERSION"
  | "UNKNOWN_KEY_VERSION"
  | "INVALID_KEY_MATERIAL";

export class AnalyticsEntityIdError extends Error {
  constructor(readonly code: AnalyticsEntityIdErrorCode) {
    super(`ANALYTICS_ENTITY_ID_REJECTED:${code}`);
    this.name = "AnalyticsEntityIdError";
  }
}

const emailLike = /@|\bemail\b/i;
const commonDigestShape = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;
const publicIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

function lengthDelimited(fields: readonly string[]) {
  const chunks: Buffer[] = [];
  for (const field of fields) {
    const encoded = Buffer.from(field, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length, 0);
    chunks.push(length, encoded);
  }
  return Buffer.concat(chunks);
}

/**
 * Produces a namespaced HMAC-SHA256 analytics identifier from an opaque public
 * identifier. Key material and its known-version ring are explicit inputs.
 */
export function createAnalyticsEntityId(input: Readonly<{
  entity: AnalyticsEntityNamespace;
  publicId: string;
  keyVersion: string;
  keys: AnalyticsEntityIdKeyRing;
}>) {
  if (!ANALYTICS_ENTITY_NAMESPACES.includes(input.entity)) {
    throw new AnalyticsEntityIdError("INVALID_ENTITY_NAMESPACE");
  }
  if (emailLike.test(input.publicId) || commonDigestShape.test(input.publicId)) {
    throw new AnalyticsEntityIdError("EMAIL_SOURCE_FORBIDDEN");
  }
  if (!publicIdPattern.test(input.publicId)) {
    throw new AnalyticsEntityIdError("INVALID_PUBLIC_ID");
  }
  if (!ANALYTICS_ID_KEY_VERSION_PATTERN.test(input.keyVersion)) {
    throw new AnalyticsEntityIdError("INVALID_KEY_VERSION");
  }
  const key = input.keys.get(input.keyVersion);
  if (!key) {
    throw new AnalyticsEntityIdError("UNKNOWN_KEY_VERSION");
  }
  if (key.byteLength < 32 || key.byteLength > 128) {
    throw new AnalyticsEntityIdError("INVALID_KEY_MATERIAL");
  }
  const digest = createHmac("sha256", Buffer.from(key))
    .update(lengthDelimited(["analytics-entity-id:v1", input.keyVersion, input.entity, input.publicId]))
    .digest("base64url");
  return `aid1.${digest}` as const;
}
