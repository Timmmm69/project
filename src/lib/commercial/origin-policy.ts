function trustedOriginConfig() {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== appUrl) return null;
  return {
    origin: parsed.origin,
    host: parsed.host,
    protocol: parsed.protocol.replace(":", ""),
    trustedProxy: process.env.TRUSTED_PROXY === "true"
  } as const;
}

export function requireTrustedOrigin(request: Request): boolean {
  if (isTestInternalRequest(request)) return true;
  const config = trustedOriginConfig();
  if (!config) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin !== config.origin) return false;
  const host = config.trustedProxy
    ? request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    : request.headers.get("host");
  if (!host) return false;
  if (host !== config.host) return false;
  if (config.trustedProxy) {
    const proto = request.headers.get("x-forwarded-proto");
    if (proto && proto !== config.protocol) return false;
  }
  return true;
}

export function isServerToServerCallback(): boolean {
  return false;
}

function isTestInternalRequest(request: Request): boolean {
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    return false;
  }
  return request.headers.get("x-test-internal-request") === "true";
}
