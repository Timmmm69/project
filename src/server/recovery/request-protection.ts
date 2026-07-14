const allowedProtocols = new Set(["http:", "https:"]);

function parseOrigin(value: string) {
  try {
    const parsed = new URL(value);
    if (
      !allowedProtocols.has(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function trustedOriginForRequest(request: Request, configuredOrigin?: string) {
  try {
    const candidate = configuredOrigin ? new URL(configuredOrigin) : new URL(request.url);
    if (!allowedProtocols.has(candidate.protocol) || candidate.username || candidate.password) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function hasValidOriginAndHost(request: Request, configuredOrigin?: string) {
  const originValue = request.headers.get("origin");
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!originValue || originValue === "null" || !host) return false;

  const origin = parseOrigin(originValue);
  const trusted = trustedOriginForRequest(request, configuredOrigin);
  if (!origin || !trusted) return false;

  try {
    const requestUrl = new URL(request.url);
    return origin.origin === trusted.origin &&
      requestUrl.origin === trusted.origin &&
      host === trusted.host.toLowerCase();
  } catch {
    return false;
  }
}

function hasJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!contentType) return false;
  const [mediaType, ...parameters] = contentType.split(";").map((value) => value.trim());
  if (mediaType.toLowerCase() !== "application/json") return false;
  return parameters.every((parameter) => {
    const [rawName, rawValue, ...extra] = parameter.split("=").map((value) => value.trim());
    if (extra.length > 0 || rawName.toLowerCase() !== "charset") return false;
    const value = rawValue.replace(/^"|"$/g, "").toLowerCase();
    return value === "utf-8";
  });
}

export function isProtectedRecoveryPost(request: Request, configuredOrigin?: string) {
  return hasValidOriginAndHost(request, configuredOrigin) && hasJsonContentType(request);
}

export async function isProtectedRecoveryDelete(request: Request, configuredOrigin?: string) {
  if (!hasValidOriginAndHost(request, configuredOrigin)) return false;
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && declaredLength !== "0") return false;
  if (request.headers.has("transfer-encoding")) return false;
  try {
    return (await request.arrayBuffer()).byteLength === 0;
  } catch {
    return false;
  }
}
