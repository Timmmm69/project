import { describe, expect, it } from "vitest";
import { apiSuccess, apiFailure, PAYMENT_RESPONSE_HEADERS } from "@/lib/api-response";

function expectSecurityHeaders(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

function expectNoCacheableHeaders(response: Response) {
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  expect(cacheControl).not.toContain("public");
  expect(cacheControl).not.toContain("max-age");
  expect(cacheControl).not.toContain("s-maxage");
  expect(response.headers.get("ETag")).toBeNull();
  expect(response.headers.get("Last-Modified")).toBeNull();
}

describe("payment response policy", () => {
  describe("PAYMENT_RESPONSE_HEADERS constant", () => {
    it("defines no-store Cache-Control", () => {
      expect(PAYMENT_RESPONSE_HEADERS["Cache-Control"]).toBe("no-store");
    });

    it("defines no-referrer Referrer-Policy", () => {
      expect(PAYMENT_RESPONSE_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    });
  });

  describe("apiSuccess applies security headers", () => {
    it("includes Cache-Control: no-store on success response", () => {
      const response = apiSuccess({ ok: true }, { status: 200 });
      expectSecurityHeaders(response);
    });

    it("includes Referrer-Policy: no-referrer on success response", () => {
      const response = apiSuccess({ ok: true });
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    });

    it("applies headers on 201 created response", () => {
      const response = apiSuccess({ id: "x" }, { status: 201 });
      expectSecurityHeaders(response);
      expect(response.status).toBe(201);
    });

    it("applies headers even when no init is passed", () => {
      const response = apiSuccess({ value: 1 });
      expectSecurityHeaders(response);
    });

    it("merges additional caller headers with security headers", () => {
      const response = apiSuccess({ data: true }, {
        headers: { "X-Custom": "test" }
      });
      expectSecurityHeaders(response);
      expect(response.headers.get("X-Custom")).toBe("test");
    });

    it("does not produce cacheable payment responses", () => {
      const response = apiSuccess({ result: 1 });
      expectNoCacheableHeaders(response);
    });
  });

  describe("apiFailure applies security headers", () => {
    it("includes headers on 400 error", () => {
      const response = apiFailure({ code: "BAD_REQUEST", message: "invalid" }, 400);
      expectSecurityHeaders(response);
    });

    it("includes headers on 403 error", () => {
      const response = apiFailure({ code: "FORBIDDEN", message: "no" }, 403);
      expectSecurityHeaders(response);
    });

    it("includes headers on 409 conflict", () => {
      const response = apiFailure({ code: "CONFLICT", message: "exists" }, 409);
      expectSecurityHeaders(response);
    });

    it("includes headers on 422 unprocessable", () => {
      const response = apiFailure({ code: "INVALID", message: "bad input" }, 422);
      expectSecurityHeaders(response);
    });

    it("includes headers on 429 rate limited with Retry-After", () => {
      const response = apiFailure(
        { code: "RATE_LIMITED", message: "too many" },
        429,
        { "Retry-After": "60" }
      );
      expectSecurityHeaders(response);
      expect(response.headers.get("Retry-After")).toBe("60");
    });

    it("includes headers on 500 server error", () => {
      const response = apiFailure({ code: "SERVER_ERROR", message: "fail" }, 500);
      expectSecurityHeaders(response);
    });

    it("does not leak security header values through error body", async () => {
      const response = apiFailure({ code: "TEST", message: "error" }, 400);
      const body = await response.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain("no-store");
      expect(bodyStr).not.toContain("no-referrer");
    });
  });

  describe("payment responses are never cacheable", () => {
    const codes = [200, 201, 400, 403, 409, 422, 429, 500];

    for (const status of codes) {
      it(`apiSuccess ${status} has no cacheable headers`, () => {
        const response = apiSuccess({ x: 1 }, { status });
        expectNoCacheableHeaders(response);
      });

      it(`apiFailure ${status} has no cacheable headers`, () => {
        const response = apiFailure({ code: "E", message: "m" }, status);
        expectNoCacheableHeaders(response);
      });
    }
  });
});
