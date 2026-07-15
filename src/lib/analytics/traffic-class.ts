export const TRAFFIC_CLASSES = ["external_user", "internal_qa", "admin", "synthetic"] as const;
export type TrafficClass = (typeof TRAFFIC_CLASSES)[number];

export const TRAFFIC_CLASS_ASSIGNMENT_SOURCES = [
  "default_external_user",
  "trusted_server_session",
  "test_fixture",
  "signed_internal_context"
] as const;
export type TrafficClassAssignmentSource = (typeof TRAFFIC_CLASS_ASSIGNMENT_SOURCES)[number];

export type TrustedAnalyticsTrafficContext =
  | Readonly<{ kind: "trusted_server_session"; trafficClass: "internal_qa" | "admin" }>
  | Readonly<{ kind: "test_fixture"; trafficClass: "internal_qa" | "synthetic" }>
  | Readonly<{ kind: "signed_internal_context"; trafficClass: "internal_qa" | "admin" | "synthetic" }>;

export type AnalyticsTrafficAssignment = Readonly<{
  traffic_class: TrafficClass;
  traffic_class_assignment_source: TrafficClassAssignmentSource;
}>;

/** Client hints are deliberately ignored unless a separately trusted context exists. */
export function assignAnalyticsTrafficClass(input: Readonly<{
  clientHint?: TrafficClass;
  trustedContext?: TrustedAnalyticsTrafficContext;
}> = {}): AnalyticsTrafficAssignment {
  if (!input.trustedContext) {
    return {
      traffic_class: "external_user",
      traffic_class_assignment_source: "default_external_user"
    };
  }
  return {
    traffic_class: input.trustedContext.trafficClass,
    traffic_class_assignment_source: input.trustedContext.kind
  };
}

export function isValidAnalyticsTrafficAssignment(
  trafficClass: TrafficClass,
  source: TrafficClassAssignmentSource
) {
  if (source === "default_external_user") return trafficClass === "external_user";
  if (source === "trusted_server_session") return trafficClass === "internal_qa" || trafficClass === "admin";
  if (source === "test_fixture") return trafficClass === "internal_qa" || trafficClass === "synthetic";
  return trafficClass === "internal_qa" || trafficClass === "admin" || trafficClass === "synthetic";
}
