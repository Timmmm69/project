type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function allowCommercialRefresh(key: string, now = Date.now()) {
  return allowCommercialAction(`refresh:${key}`, 10, now);
}

export function allowCommercialAction(key: string, limit: number, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= limit) {
    return false;
  }
  current.count += 1;
  return true;
}
