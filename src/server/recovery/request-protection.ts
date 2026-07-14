const allowedProtocols = new Set(["http:", "https:"]);

export function canonicalRecoveryOrigin(value: string | undefined) {
  if (!value) return null;
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
    return parsed.origin;
  } catch {
    return null;
  }
}

function hasValidOriginAndHost(request: Request, configuredOrigin: string) {
  const originValue = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!originValue || originValue === "null" || !host) return false;

  const trusted = canonicalRecoveryOrigin(configuredOrigin);
  if (!trusted || trusted !== configuredOrigin || originValue !== trusted) return false;

  try {
    const requestUrl = new URL(request.url);
    return requestUrl.origin === trusted && host === new URL(trusted).host;
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

export function isProtectedRecoveryPost(request: Request, configuredOrigin: string) {
  return hasValidOriginAndHost(request, configuredOrigin) && hasJsonContentType(request);
}

export async function isProtectedRecoveryDelete(request: Request, configuredOrigin: string) {
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
