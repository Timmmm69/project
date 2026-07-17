import { createHash } from "node:crypto";
import {
  safelyWriteCanonicalBackendAnalyticsEvent,
  type CanonicalBackendRuntimeInput,
  type SafeCanonicalBackendRuntimeResult
} from "@/lib/analytics/canonical-runtime";
import {
  ANALYTICS_ID_KEY_VERSION_PATTERN,
  createAnalyticsEntityId,
  type AnalyticsEntityIdKeyRing
} from "@/lib/analytics/entity-id";
import {
  classifyRuntimeEnvironment,
  type RuntimeEnvironment
} from "@/server/runtime-config/runtime-environment";

export type CanonicalOrderCreatedFacts = Readonly<{
  checkoutFlowId: string;
  orderPublicId: string;
  occurredAt: Date;
  productId: string;
  testId: string;
  examMode: "GENERIC" | "RIKZ_RUSSIAN_2026" | "generic" | "rikz_russian_2026";
}>;

export type CanonicalOrderCreatedEmissionResult =
  | Readonly<{ enabled: false; accepted: false; inserted: false }>
  | Readonly<{ enabled: true; accepted: true; inserted: boolean }>
  | Readonly<{ enabled: true; accepted: false; inserted: false }>;

export type CanonicalOrderCreatedEmitter = (
  facts: CanonicalOrderCreatedFacts
) => Promise<CanonicalOrderCreatedEmissionResult>;

type CanonicalOrderCreatedRuntime = (
  input: CanonicalBackendRuntimeInput<"order_created">
) => Promise<SafeCanonicalBackendRuntimeResult>;

export type CanonicalOrderCreatedDependencies = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  receiverClock?: () => Date;
  canonicalRuntime?: CanonicalOrderCreatedRuntime;
  entityId?: typeof createAnalyticsEntityId;
  deterministicEventId?: (name: string) => string;
}>;

const disabledResult = Object.freeze({
  enabled: false,
  accepted: false,
  inserted: false
} as const);

const rejectedResult = Object.freeze({
  enabled: true,
  accepted: false,
  inserted: false
} as const);

const orderCreatedFactKeys = new Set([
  "checkoutFlowId",
  "orderPublicId",
  "occurredAt",
  "productId",
  "testId",
  "examMode"
]);

const checkoutFlowIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV5Namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");

function hasExactFactsShape(value: unknown): value is CanonicalOrderCreatedFacts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== orderCreatedFactKeys.size || keys.some((key) => !orderCreatedFactKeys.has(key))) {
    return false;
  }
  const facts = value as Record<string, unknown>;
  return (
    typeof facts.checkoutFlowId === "string" &&
    typeof facts.orderPublicId === "string" &&
    facts.occurredAt instanceof Date &&
    typeof facts.productId === "string" &&
    typeof facts.testId === "string" &&
    typeof facts.examMode === "string"
  );
}

function normalizeExamMode(value: CanonicalOrderCreatedFacts["examMode"]) {
  if (value === "GENERIC" || value === "generic") return "generic" as const;
  if (value === "RIKZ_RUSSIAN_2026" || value === "rikz_russian_2026") {
    return "rikz_russian_2026" as const;
  }
  throw new Error("ANALYTICS_ORDER_CREATED_EXAM_MODE_REJECTED");
}

const analyticsEnvironmentByRuntime = Object.freeze({
  development: "development",
  test: "test",
  staging: "sandbox",
  production: "production"
} satisfies Readonly<Record<RuntimeEnvironment, "development" | "test" | "sandbox" | "production">>);

function uuidV5(name: string) {
  const bytes = createHash("sha1")
    .update(uuidV5Namespace)
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function emitCanonicalOrderCreated(
  facts: CanonicalOrderCreatedFacts,
  dependencies: CanonicalOrderCreatedDependencies = {}
): Promise<CanonicalOrderCreatedEmissionResult> {
  const environment = dependencies.environment ?? process.env;
  if (environment.ANALYTICS_ENABLED?.trim().toLowerCase() !== "true") {
    return disabledResult;
  }

  try {
    if (!hasExactFactsShape(facts) || !checkoutFlowIdPattern.test(facts.checkoutFlowId)) {
      return rejectedResult;
    }

    const runtimeEnvironment = classifyRuntimeEnvironment(environment);
    if (runtimeEnvironment.status === "INVALID") {
      return rejectedResult;
    }

    const keyMaterial = environment.ANALYTICS_ID_HMAC_KEY?.trim();
    const keyVersion = environment.ANALYTICS_ID_KEY_VERSION?.trim();
    if (
      !keyMaterial ||
      Buffer.byteLength(keyMaterial, "utf8") < 32 ||
      Buffer.byteLength(keyMaterial, "utf8") > 128 ||
      !keyVersion ||
      !ANALYTICS_ID_KEY_VERSION_PATTERN.test(keyVersion)
    ) {
      return rejectedResult;
    }

    const keys: AnalyticsEntityIdKeyRing = new Map([
      [keyVersion, Buffer.from(keyMaterial, "utf8")]
    ]);
    const orderEntityId = (dependencies.entityId ?? createAnalyticsEntityId)({
      entity: "order",
      publicId: facts.orderPublicId,
      keyVersion,
      keys
    });
    const transitionKey = `order_created:${facts.checkoutFlowId}`;
    const receiverContext = {
      environment: analyticsEnvironmentByRuntime[runtimeEnvironment.environment],
      receivedAt: (dependencies.receiverClock ?? (() => new Date()))().toISOString(),
      ...(runtimeEnvironment.environment === "test"
        ? {
            trustedTrafficContext: {
              kind: "test_fixture" as const,
              trafficClass: "synthetic" as const
            }
          }
        : {})
    };
    const runtimeResult = await (
      dependencies.canonicalRuntime ?? safelyWriteCanonicalBackendAnalyticsEvent
    )({
      transitionKey,
      producerEvent: {
        event_id: (dependencies.deterministicEventId ?? uuidV5)(transitionKey),
        event_name: "order_created",
        event_version: 1,
        occurred_at: facts.occurredAt.toISOString(),
        analytics_id_key_version: keyVersion,
        properties: {
          checkout_flow_id: facts.checkoutFlowId,
          order_public_id_hash: orderEntityId,
          product_id: facts.productId,
          test_id: facts.testId,
          exam_mode: normalizeExamMode(facts.examMode),
          order_status: "created",
          access_source: "paid"
        }
      },
      receiverContext
    });

    if (!runtimeResult.accepted) return rejectedResult;
    return { enabled: true, accepted: true, inserted: runtimeResult.inserted };
  } catch {
    return rejectedResult;
  }
}
