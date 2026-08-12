import { NextResponse } from "next/server";

export const PAYMENT_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer"
});

function paymentHeaders(extraHeaders?: HeadersInit) {
  const headers = new Headers(PAYMENT_RESPONSE_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: ApiErrorBody;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>(
    {
      success: true,
      data
    },
    { ...init, headers: paymentHeaders(init?.headers) }
  );
}

export function apiFailure(error: ApiErrorBody, status = 400, extraHeaders?: Record<string, string>) {
  const headers = new Headers(PAYMENT_RESPONSE_HEADERS);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }
  return NextResponse.json<ApiFailure>(
    {
      success: false,
      error
    },
    { status, headers }
  );
}
