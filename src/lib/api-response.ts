import { NextResponse } from "next/server";

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
    init
  );
}

export function apiFailure(error: ApiErrorBody, status = 400, extraHeaders?: Record<string, string>) {
  let responseHeaders: Headers | undefined;
  if (extraHeaders) {
    responseHeaders = new Headers();
    for (const [key, value] of Object.entries(extraHeaders)) {
      responseHeaders.set(key, value);
    }
  }
  return NextResponse.json<ApiFailure>(
    {
      success: false,
      error
    },
    {
      status,
      ...(responseHeaders ? { headers: responseHeaders } : {})
    }
  );
}
