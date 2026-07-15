export const PRODUCT_CTA_TYPES = ["open_product", "buy_access", "existing_access"] as const;
export type ProductCtaType = (typeof PRODUCT_CTA_TYPES)[number];

export const PRODUCT_CTA_SURFACES = ["catalog", "product"] as const;
export type ProductCtaSurface = (typeof PRODUCT_CTA_SURFACES)[number];

export const CHECKOUT_ENTRY_POINTS = ["product_page", "checkout_restart"] as const;
export type CheckoutEntryPoint = (typeof CHECKOUT_ENTRY_POINTS)[number];

export const RESULT_VIEW_CONTEXTS = ["completion", "recovery", "direct"] as const;
export type ResultViewContext = (typeof RESULT_VIEW_CONTEXTS)[number];

export const RESULT_REOPEN_SEQUENCE_BUCKETS = ["second", "third_to_fifth", "sixth_plus"] as const;
export type ResultReopenSequenceBucket = (typeof RESULT_REOPEN_SEQUENCE_BUCKETS)[number];

export const ANALYTICS_FAILURE_STAGES = [
  "catalog",
  "product",
  "checkout",
  "payment",
  "access_grant",
  "access_claim",
  "attempt_start",
  "answer_save",
  "attempt_resume",
  "attempt_completion",
  "result",
  "recovery"
] as const;
export type AnalyticsFailureStage = (typeof ANALYTICS_FAILURE_STAGES)[number];

export const CLIENT_ERROR_CODES = [
  "request_failed",
  "load_failed",
  "validation_failed",
  "network_unavailable",
  "save_failed",
  "payment_status_unavailable",
  "access_unavailable",
  "attempt_unavailable",
  "completion_failed",
  "result_unavailable",
  "rate_limited",
  "unknown_sanitized"
] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export const BACKEND_OPERATION_ERROR_CODES = [
  "provider_unavailable",
  "payment_state_changed",
  "payment_verification_failed",
  "access_grant_failed",
  "database_operation_failed",
  "attempt_state_conflict",
  "save_failed",
  "completion_failed",
  "recovery_failed",
  "rate_limited",
  "unknown_sanitized"
] as const;
export type BackendOperationErrorCode = (typeof BACKEND_OPERATION_ERROR_CODES)[number];

export const CLIENT_ERROR_REPEAT_BUCKETS = ["first", "2_3", "4_10", "gt_10"] as const;
export type ClientErrorRepeatBucket = (typeof CLIENT_ERROR_REPEAT_BUCKETS)[number];

export const PAYMENT_FAILURE_REASON_CODES = [
  "provider_declined",
  "provider_processing_failed",
  "provider_timeout",
  "unknown_sanitized"
] as const;
export type PaymentFailureReasonCode = (typeof PAYMENT_FAILURE_REASON_CODES)[number];

export const PAYMENT_CANCEL_SOURCES = ["user", "provider", "system"] as const;
export type PaymentCancelSource = (typeof PAYMENT_CANCEL_SOURCES)[number];

export const ACCESS_GRANT_REASONS = [
  "confirmed_payment",
  "manual_grant",
  "access_code_redeemed",
  "free_access",
  "support_replacement",
  "qa_fixture"
] as const;
export type AccessGrantReason = (typeof ACCESS_GRANT_REASONS)[number];

export const ACCESS_CLAIM_FAILURE_REASON_CODES = [
  "invalid_challenge",
  "challenge_expired",
  "challenge_locked",
  "challenge_replay",
  "rate_limited",
  "access_unavailable",
  "verification_unavailable",
  "unknown_sanitized"
] as const;
export type AccessClaimFailureReasonCode = (typeof ACCESS_CLAIM_FAILURE_REASON_CODES)[number];

export const ANSWER_SAVE_MODES = ["autosave", "manual_retry", "completion_flush", "timer_expiry_flush"] as const;
export type AnswerSaveMode = (typeof ANSWER_SAVE_MODES)[number];

export const ATTEMPT_RESUME_METHODS = ["reload", "recovery", "access_code", "verified_session"] as const;
export type AttemptResumeMethod = (typeof ATTEMPT_RESUME_METHODS)[number];
