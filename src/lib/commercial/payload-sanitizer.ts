const FORBIDDEN_KEY_PATTERNS = [
  "pan",
  "masked_pan",
  "maskedpan",
  "card_number",
  "cardnumber",
  "cvv",
  "cvc",
  "cvv2",
  "expiry",
  "expiration",
  "exp_date",
  "expdate",
  "3ds",
  "three_ds",
  "threeds",
  "signature",
  "secret",
  "private_key",
  "privatekey",
  "api_key",
  "apikey",
  "session_token",
  "sessiontoken",
  "session_id",
  "sessionid",
  "raw_body",
  "rawbody",
  "raw_request",
  "rawrequest",
  "raw_response",
  "rawresponse",
  "request_body",
  "requestbody",
  "response_body",
  "responsebody",
  "raw_payload",
  "rawpayload",
  "payment_url",
  "paymenturl",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "credential",
  "password",
  "passwd",
  "pwd"
];

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_.\s]/g, "");
  return FORBIDDEN_KEY_PATTERNS.includes(normalized);
}

export function sanitizeProviderPayload(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string" || typeof input === "number" || typeof input === "boolean") return input;

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeProviderPayload(item));
  }

  if (typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isForbiddenKey(key)) continue;
      result[key] = sanitizeProviderPayload(value);
    }
    return result;
  }

  return input;
}

export function containsForbiddenKeys(input: unknown): string[] {
  const found: string[] = [];
  const stack = [{ value: input, path: "$" }];

  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.value === null || item.value === undefined) continue;
    if (typeof item.value === "string" || typeof item.value === "number" || typeof item.value === "boolean") continue;

    if (Array.isArray(item.value)) {
      for (let i = 0; i < item.value.length; i++) {
        stack.push({ value: item.value[i], path: `${item.path}[${i}]` });
      }
      continue;
    }

    if (typeof item.value === "object") {
      for (const [key, value] of Object.entries(item.value as Record<string, unknown>)) {
        if (isForbiddenKey(key)) {
          found.push(`${item.path}.${key}`);
        }
        stack.push({ value, path: `${item.path}.${key}` });
      }
    }
  }

  return found;
}
