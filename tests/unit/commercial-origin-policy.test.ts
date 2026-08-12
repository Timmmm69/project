import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isServerToServerCallback, requireTrustedOrigin } from "@/lib/commercial/origin-policy";

const originalEnv = { ...process.env };

function req(init: { url?: string; origin?: string | null; host?: string | null; xForwardedHost?: string; xForwardedProto?: string; testInternal?: boolean } = {}) {
  const headers = new Headers();
  if (init.origin !== undefined && init.origin !== null) headers.set("origin", init.origin);
  if (init.host !== undefined && init.host !== null) headers.set("host", init.host);
  if (init.xForwardedHost !== undefined) headers.set("x-forwarded-host", init.xForwardedHost);
  if (init.xForwardedProto !== undefined) headers.set("x-forwarded-proto", init.xForwardedProto);
  if (init.testInternal) headers.set("x-test-internal-request", "true");
  return new Request(init.url ?? "https://app.example.com/api/commercial/orders", { headers });
}

function env(key: string, value: string | undefined) {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>)[key];
  } else {
    (process.env as Record<string, string | undefined>)[key]! = value;
  }
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("trusted commercial origin policy", () => {
  describe("fail-closed without APP_URL", () => {
    it("rejects when APP_URL is not set", () => {
      env("APP_URL", undefined);
      expect(requireTrustedOrigin(req({ origin: "https://app.example.com", host: "app.example.com" }))).toBe(false);
    });

    it("rejects when APP_URL is empty string", () => {
      env("APP_URL", "");
      expect(requireTrustedOrigin(req({ origin: "https://app.example.com", host: "app.example.com" }))).toBe(false);
    });
  });

  describe("with APP_URL=https://app.example.com", () => {
    beforeEach(() => {
      env("APP_URL", "https://app.example.com");
      env("TRUSTED_PROXY", undefined);
      env("NODE_ENV", undefined);
    });

    it("accepts a matching origin and host", () => {
      expect(requireTrustedOrigin(req({ origin: "https://app.example.com", host: "app.example.com" }))).toBe(true);
    });

    it("rejects a foreign origin", () => {
      expect(requireTrustedOrigin(req({ origin: "https://evil.example.com", host: "app.example.com" }))).toBe(false);
    });

    it("rejects a missing origin header (strict)", () => {
      expect(requireTrustedOrigin(req({ host: "app.example.com" }))).toBe(false);
    });

    it("rejects origin: null (CORS opaque)", () => {
      expect(requireTrustedOrigin(req({ origin: null, host: "app.example.com" }))).toBe(false);
    });

    it("rejects a missing host header", () => {
      expect(requireTrustedOrigin(req({ origin: "https://app.example.com" }))).toBe(false);
    });

    it("rejects a mismatched host header (Host spoofing)", () => {
      expect(requireTrustedOrigin(req({ origin: "https://app.example.com", host: "evil.example.com" }))).toBe(false);
    });

    it("rejects a different protocol in origin", () => {
      expect(requireTrustedOrigin(req({ origin: "http://app.example.com", host: "app.example.com" }))).toBe(false);
    });

    it("rejects an origin with a different port", () => {
      expect(requireTrustedOrigin(req({ origin: "https://app.example.com:8443", host: "app.example.com:8443" }))).toBe(false);
    });
  });

  describe("untrusted proxy (TRUSTED_PROXY not set)", () => {
    beforeEach(() => {
      env("APP_URL", "https://app.example.com");
      env("TRUSTED_PROXY", undefined);
    });

    it("ignores x-forwarded-host — uses host header directly", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "app.example.com",
        xForwardedHost: "evil.example.com"
      }))).toBe(true);
    });

    it("ignores x-forwarded-proto", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "app.example.com",
        xForwardedProto: "http"
      }))).toBe(true);
    });
  });

  describe("trusted proxy (TRUSTED_PROXY=true)", () => {
    beforeEach(() => {
      env("APP_URL", "https://app.example.com");
      env("TRUSTED_PROXY", "true");
    });

    it("uses x-forwarded-host for host validation", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "internal.proxy.local",
        xForwardedHost: "app.example.com"
      }))).toBe(true);
    });

    it("rejects a spoofed x-forwarded-host", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "internal.proxy.local",
        xForwardedHost: "evil.example.com"
      }))).toBe(false);
    });

    it("falls back to host header when x-forwarded-host is absent", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "app.example.com"
      }))).toBe(true);
    });

    it("rejects spoofed x-forwarded-proto", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "app.example.com",
        xForwardedProto: "http"
      }))).toBe(false);
    });

    it("accepts matching x-forwarded-proto", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "app.example.com",
        xForwardedProto: "https"
      }))).toBe(true);
    });

    it("accepts missing x-forwarded-proto (no proto check)", () => {
      expect(requireTrustedOrigin(req({
        origin: "https://app.example.com",
        host: "app.example.com"
      }))).toBe(true);
    });
  });

  describe("test/internal client policy", () => {
    beforeEach(() => {
      env("APP_URL", "https://app.example.com");
    });

    it("accepts a test-internal request in development", () => {
      env("NODE_ENV", "development");
      expect(requireTrustedOrigin(req({ testInternal: true }))).toBe(true);
    });

    it("accepts a test-internal request in test environment", () => {
      env("NODE_ENV", "test");
      expect(requireTrustedOrigin(req({ testInternal: true }))).toBe(true);
    });

    it("rejects a test-internal header in production NODE_ENV", () => {
      env("NODE_ENV", "production");
      expect(requireTrustedOrigin(req({ testInternal: true }))).toBe(false);
    });

    it("rejects without test-internal header in development", () => {
      env("NODE_ENV", "development");
      expect(requireTrustedOrigin(req({ origin: "https://evil.example.com", host: "evil.example.com" }))).toBe(false);
    });
  });

  describe("server-to-server callback boundary", () => {
    it("isServerToServerCallback returns false (explicit route control)", () => {
      expect(isServerToServerCallback()).toBe(false);
    });

    it("browser origin check rejects a callback-like request with missing origin", () => {
      env("APP_URL", "https://app.example.com");
      expect(requireTrustedOrigin(req({ host: "app.example.com" }))).toBe(false);
    });
  });
});
