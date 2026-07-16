import {
  persistCanonicalAnalyticsEvent,
  type CanonicalAnalyticsPersistenceInput,
  type CanonicalAnalyticsPersistenceResult
} from "@/lib/analytics/canonical-persistence";
import {
  buildCanonicalBackendAnalyticsEvent,
  type AnalyticsReceiverContext,
  type BackendAnalyticsEventName,
  type TrustedBackendAnalyticsInput
} from "@/lib/analytics/canonical-writer";
import { AnalyticsContractError } from "@/lib/analytics/event-contract";

export type CanonicalBackendRuntimeInput<
  Name extends BackendAnalyticsEventName = BackendAnalyticsEventName
> = Name extends BackendAnalyticsEventName
  ? Readonly<{
      transitionKey: string;
      producerEvent: TrustedBackendAnalyticsInput<Name>;
      receiverContext: AnalyticsReceiverContext;
    }>
  : never;

export type CanonicalBackendRuntimeResult = Readonly<{
  inserted: boolean;
}>;

export type SafeCanonicalBackendRuntimeResult =
  | Readonly<{ accepted: true; inserted: boolean }>
  | Readonly<{ accepted: false; inserted: false }>;

export type CanonicalBackendRuntimeDependencies = Readonly<{
  buildCanonicalBackendAnalyticsEvent: (
    producerEvent: unknown,
    receiverContext: AnalyticsReceiverContext
  ) => ReturnType<typeof buildCanonicalBackendAnalyticsEvent>;
  persistCanonicalAnalyticsEvent: (
    input: CanonicalAnalyticsPersistenceInput
  ) => Promise<CanonicalAnalyticsPersistenceResult>;
}>;

const defaultDependencies: CanonicalBackendRuntimeDependencies = {
  buildCanonicalBackendAnalyticsEvent,
  persistCanonicalAnalyticsEvent
};

const safeFailureResult = Object.freeze({
  accepted: false,
  inserted: false
} as const);

export async function writeCanonicalBackendAnalyticsEvent<
  Name extends BackendAnalyticsEventName = BackendAnalyticsEventName
>(
  input: CanonicalBackendRuntimeInput<Name>,
  dependencies: CanonicalBackendRuntimeDependencies = defaultDependencies
): Promise<CanonicalBackendRuntimeResult> {
  const construction = dependencies.buildCanonicalBackendAnalyticsEvent(
    input.producerEvent,
    input.receiverContext
  );

  if (!construction.success) {
    throw new AnalyticsContractError(construction.error);
  }

  const persistenceResult = await dependencies.persistCanonicalAnalyticsEvent({
    transitionKey: input.transitionKey,
    event: construction.data
  });

  return { inserted: persistenceResult.inserted };
}

export async function safelyWriteCanonicalBackendAnalyticsEvent<
  Name extends BackendAnalyticsEventName = BackendAnalyticsEventName
>(
  input: CanonicalBackendRuntimeInput<Name>,
  dependencies: CanonicalBackendRuntimeDependencies = defaultDependencies
): Promise<SafeCanonicalBackendRuntimeResult> {
  try {
    const result = await writeCanonicalBackendAnalyticsEvent(input, dependencies);
    return { accepted: true, inserted: result.inserted };
  } catch {
    return safeFailureResult;
  }
}
