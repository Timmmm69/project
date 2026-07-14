import { NextResponse } from "next/server";

export const RECOVERY_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer"
});

function recoveryHeaders(extraHeaders?: HeadersInit) {
  const headers = new Headers(RECOVERY_RESPONSE_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

export function recoveryJson<T>(body: T, status: number, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: recoveryHeaders(extraHeaders)
  });
}

export function recoveryError(
  code: string,
  message: string,
  status: number,
  extraHeaders?: HeadersInit
) {
  return recoveryJson({ error: { code, message } }, status, extraHeaders);
}

export function recoveryNoContent() {
  return new NextResponse(null, {
    status: 204,
    headers: recoveryHeaders()
  });
}

export function recoveryCsrfRejected() {
  return recoveryError("CSRF_REJECTED", "Invalid request origin.", 403);
}
