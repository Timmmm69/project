export const RECOVERY_UI_PHASES = [
  "closed",
  "enter_email",
  "requesting_code",
  "code_sent",
  "verifying_code",
  "resolving",
  "access_unstarted",
  "attempt_active",
  "result_available",
  "start_window_expired",
  "no_access",
  "support_required",
  "continuing",
  "temporary_error",
  "feature_unavailable"
] as const;

export type RecoveryUiPhase = (typeof RECOVERY_UI_PHASES)[number];
export type RecoveryBusinessState = Extract<
  RecoveryUiPhase,
  | "access_unstarted"
  | "attempt_active"
  | "result_available"
  | "start_window_expired"
  | "no_access"
  | "support_required"
>;
export type RecoveryRetryTarget = "request_code" | "verify_code" | "resolve" | "continue";

export type RecoveryUiState = Readonly<{
  phase: RecoveryUiPhase;
  errorCode: string | null;
  maskedEmail: string | null;
  resendAvailableAt: number | null;
  retryAvailableAt: number | null;
  retryTarget: RecoveryRetryTarget | null;
  requestOperationId: string | null;
  verificationOperationId: string | null;
  continuationOperationId: string | null;
}>;

export type RecoveryUiAction =
  | Readonly<{ type: "OPEN" }>
  | Readonly<{ type: "EMAIL_CHANGED" }>
  | Readonly<{ type: "REQUEST_STARTED"; operationId: string }>
  | Readonly<{
      type: "REQUEST_SUCCEEDED";
      maskedEmail: string | null;
      resendAfterSeconds: number;
      now: number;
    }>
  | Readonly<{ type: "VERIFICATION_INPUT_CHANGED" }>
  | Readonly<{ type: "VERIFICATION_STARTED"; operationId: string }>
  | Readonly<{ type: "VERIFICATION_SUCCEEDED" }>
  | Readonly<{ type: "RESOLVE_STARTED" }>
  | Readonly<{ type: "RESOLVE_SUCCEEDED"; state: RecoveryBusinessState }>
  | Readonly<{ type: "CODE_INVALID" }>
  | Readonly<{ type: "CODE_EXPIRED"; now: number }>
  | Readonly<{ type: "SESSION_REQUIRED"; errorCode?: string }>
  | Readonly<{ type: "SCOPE_NOT_ALLOWED"; errorCode?: string }>
  | Readonly<{ type: "FEATURE_UNAVAILABLE" }>
  | Readonly<{ type: "CONTINUATION_STARTED"; operationId: string }>
  | Readonly<{ type: "STATE_CHANGED" }>
  | Readonly<{ type: "CONTINUATION_CONFLICT" }>
  | Readonly<{
      type: "TEMPORARY_ERROR";
      errorCode: string;
      retryTarget: RecoveryRetryTarget;
      retryAfterSeconds?: number;
      now: number;
    }>
  | Readonly<{ type: "INVALID_REQUEST"; context: "email" | "code" }>
  | Readonly<{ type: "CANCEL" }>;

export const initialRecoveryUiState: RecoveryUiState = Object.freeze({
  phase: "closed",
  errorCode: null,
  maskedEmail: null,
  resendAvailableAt: null,
  retryAvailableAt: null,
  retryTarget: null,
  requestOperationId: null,
  verificationOperationId: null,
  continuationOperationId: null
});

export function recoveryUiReducer(
  state: RecoveryUiState,
  action: RecoveryUiAction
): RecoveryUiState {
  switch (action.type) {
    case "OPEN":
      return { ...initialRecoveryUiState, phase: "enter_email" };
    case "EMAIL_CHANGED":
      return {
        ...state,
        phase: "enter_email",
        errorCode: null,
        maskedEmail: null,
        resendAvailableAt: null,
        requestOperationId: null,
        verificationOperationId: null
      };
    case "REQUEST_STARTED":
      return {
        ...state,
        phase: "requesting_code",
        errorCode: null,
        retryTarget: null,
        retryAvailableAt: null,
        requestOperationId: action.operationId
      };
    case "REQUEST_SUCCEEDED":
      return {
        ...state,
        phase: "code_sent",
        errorCode: null,
        maskedEmail: action.maskedEmail,
        resendAvailableAt: action.now + action.resendAfterSeconds * 1000,
        retryAvailableAt: null,
        retryTarget: null,
        requestOperationId: null,
        verificationOperationId: null
      };
    case "VERIFICATION_INPUT_CHANGED":
      return { ...state, errorCode: null, verificationOperationId: null };
    case "VERIFICATION_STARTED":
      return {
        ...state,
        phase: "verifying_code",
        errorCode: null,
        retryTarget: null,
        retryAvailableAt: null,
        verificationOperationId: action.operationId
      };
    case "VERIFICATION_SUCCEEDED":
      return {
        ...state,
        phase: "resolving",
        errorCode: null,
        verificationOperationId: null,
        retryTarget: null,
        retryAvailableAt: null
      };
    case "RESOLVE_STARTED":
      return { ...state, phase: "resolving", errorCode: null, retryTarget: null };
    case "RESOLVE_SUCCEEDED":
      return {
        ...state,
        phase: action.state,
        errorCode: null,
        retryTarget: null,
        retryAvailableAt: null,
        continuationOperationId: null
      };
    case "CODE_INVALID":
      return { ...state, phase: "code_sent", errorCode: "CODE_INVALID" };
    case "CODE_EXPIRED":
      return {
        ...state,
        phase: "code_sent",
        errorCode: "CODE_EXPIRED",
        resendAvailableAt: action.now,
        verificationOperationId: null
      };
    case "SESSION_REQUIRED":
      return {
        ...initialRecoveryUiState,
        phase: "enter_email",
        errorCode: action.errorCode ?? null
      };
    case "SCOPE_NOT_ALLOWED":
      return {
        ...state,
        phase: "support_required",
        errorCode: action.errorCode ?? "SCOPE_NOT_ALLOWED",
        retryTarget: null,
        continuationOperationId: null
      };
    case "FEATURE_UNAVAILABLE":
      return { ...initialRecoveryUiState, phase: "feature_unavailable" };
    case "CONTINUATION_STARTED":
      return {
        ...state,
        phase: "continuing",
        errorCode: null,
        retryTarget: null,
        continuationOperationId: action.operationId
      };
    case "STATE_CHANGED":
      return {
        ...state,
        phase: "resolving",
        errorCode: null,
        retryTarget: null,
        continuationOperationId: null
      };
    case "CONTINUATION_CONFLICT":
      return {
        ...state,
        phase: "support_required",
        errorCode: "CONTINUATION_OPERATION_CONFLICT",
        retryTarget: null
      };
    case "TEMPORARY_ERROR":
      return {
        ...state,
        phase: "temporary_error",
        errorCode: action.errorCode,
        retryTarget: action.retryTarget,
        retryAvailableAt: action.retryAfterSeconds
          ? action.now + action.retryAfterSeconds * 1000
          : action.now
      };
    case "INVALID_REQUEST":
      return {
        ...state,
        phase: action.context === "email" ? "enter_email" : "code_sent",
        errorCode: "INVALID_REQUEST"
      };
    case "CANCEL":
      return initialRecoveryUiState;
  }
}

export function reuseLogicalOperationId(
  current: string | null,
  create: () => string
) {
  return current ?? create();
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, allowedKeys: readonly string[]) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function recoveryErrorCode(value: unknown) {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== "string") {
    return null;
  }
  return value.error.code;
}

export function parseChallengeResponse(value: unknown) {
  if (!isRecord(value) ||
    !hasOnlyKeys(value, ["state", "messageKey", "emailMasked", "resendAfterSeconds"]) ||
    value.state !== "code_sent" ||
    value.messageKey !== "email.sent_neutral" ||
    !Number.isInteger(value.resendAfterSeconds) ||
    (value.resendAfterSeconds as number) < 1 ||
    (value.resendAfterSeconds as number) > 86_400 ||
    !(value.emailMasked === undefined ||
      (typeof value.emailMasked === "string" && value.emailMasked.length <= 320))) {
    return null;
  }
  return {
    maskedEmail: typeof value.emailMasked === "string" ? value.emailMasked : null,
    resendAfterSeconds: value.resendAfterSeconds as number
  };
}

export function parseVerificationResponse(value: unknown) {
  return isRecord(value) &&
    hasOnlyKeys(value, ["state", "messageKey", "nextAction"]) &&
    value.state === "verified" &&
    value.messageKey === "email.code.verified" && value.nextAction === "RESOLVE";
}

const businessStates = new Set<RecoveryBusinessState>([
  "access_unstarted",
  "attempt_active",
  "result_available",
  "start_window_expired",
  "no_access",
  "support_required"
]);

export function parseRecoveryStateResponse(value: unknown): RecoveryBusinessState | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["state", "screen", "nextAction"]) ||
    value.screen !== "REC-01" ||
    typeof value.state !== "string" || !businessStates.has(value.state as RecoveryBusinessState)) {
    return null;
  }
  const actionable = value.state === "access_unstarted" ||
    value.state === "attempt_active" || value.state === "result_available";
  if (value.nextAction !== (actionable ? "CONTINUE" : null)) return null;
  return value.state as RecoveryBusinessState;
}

export type RecoveryContinuationAction = "OPEN_PRE" | "OPEN_ATTEMPT" | "OPEN_RESULT";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const testSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isAllowedRecoveryNextUrl(
  action: RecoveryContinuationAction,
  nextUrl: string
) {
  if (!nextUrl.startsWith("/") || nextUrl.startsWith("//") ||
    nextUrl.includes("\\") || nextUrl.includes("?") || nextUrl.includes("#") ||
    nextUrl.slice(1).includes("//") || /^[a-z][a-z0-9+.-]*:/i.test(nextUrl.slice(1))) {
    return false;
  }
  if (action === "OPEN_PRE") {
    return nextUrl.startsWith("/tests/") && testSlugPattern.test(nextUrl.slice(7));
  }
  const prefix = action === "OPEN_ATTEMPT" ? "/attempts/" : "/results/";
  return nextUrl.startsWith(prefix) && uuidPattern.test(nextUrl.slice(prefix.length));
}

export function parseContinuationResponse(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["nextAction", "nextUrl"]) ||
    (value.nextAction !== "OPEN_PRE" &&
      value.nextAction !== "OPEN_ATTEMPT" && value.nextAction !== "OPEN_RESULT") ||
    typeof value.nextUrl !== "string" ||
    !isAllowedRecoveryNextUrl(value.nextAction, value.nextUrl)) {
    return null;
  }
  return { nextAction: value.nextAction, nextUrl: value.nextUrl };
}

const safeErrorCopy: Readonly<Record<string, string>> = Object.freeze({
  INVALID_REQUEST: "Проверьте введённые данные и попробуйте ещё раз.",
  TEMPORARY_UNAVAILABLE: "Восстановление временно недоступно. Попробуйте ещё раз.",
  RESOLUTION_TEMPORARY_ERROR: "Не удалось проверить состояние доступа. Попробуйте ещё раз.",
  RATE_LIMITED: "Слишком много запросов. Повторите попытку позже.",
  CODE_INVALID: "Код не подошёл. Проверьте шесть цифр и попробуйте ещё раз.",
  CODE_EXPIRED: "Срок действия кода истёк. Запросите новый код.",
  CHALLENGE_NOT_ACTIVE: "Запрос кода больше не активен. Введите email ещё раз.",
  RECOVERY_SESSION_REQUIRED: "Сессия восстановления завершена. Введите email ещё раз.",
  SCOPE_NOT_ALLOWED: "Не удалось безопасно продолжить восстановление.",
  CONTINUATION_OPERATION_CONFLICT: "Не удалось безопасно продолжить восстановление.",
  NETWORK_FAILURE: "Не удалось связаться с сервером. Проверьте подключение и повторите попытку.",
  MALFORMED_RESPONSE: "Получен некорректный ответ. Попробуйте ещё раз.",
  INVALID_CODE_FORMAT: "Введите код из шести цифр."
});

export function safeRecoveryErrorText(code: string | null) {
  if (!code) return null;
  return safeErrorCopy[code] ?? "Восстановление временно недоступно. Попробуйте ещё раз.";
}
