type CacheKey = string;

export type CachedInvoice = {
  invoiceId: string;
  invoicePath: string;
};

type CacheEntry = CachedInvoice & {
  expiresAt: number;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_TTL_MS = DAY_IN_MS;

const cache = new Map<CacheKey, CacheEntry>();

function buildCacheKey(apiKey: string, idempotencyKey: string): CacheKey {
  return `${apiKey}:${idempotencyKey}`;
}

function isExpired(entry: CacheEntry, now: number): boolean {
  return entry.expiresAt <= now;
}

function purgeExpired(now: number): void {
  for (const [key, entry] of cache.entries()) {
    if (isExpired(entry, now)) {
      cache.delete(key);
    }
  }
}

export function getCachedInvoice(apiKey: string, idempotencyKey: string): CachedInvoice | null {
  const now = Date.now();
  purgeExpired(now);
  const key = buildCacheKey(apiKey, idempotencyKey);
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (isExpired(entry, now)) {
    cache.delete(key);
    return null;
  }
  return { invoiceId: entry.invoiceId, invoicePath: entry.invoicePath };
}

export function storeCachedInvoice(
  apiKey: string,
  idempotencyKey: string,
  payload: CachedInvoice
): void {
  const now = Date.now();
  purgeExpired(now);
  const key = buildCacheKey(apiKey, idempotencyKey);
  cache.set(key, {
    ...payload,
    expiresAt: now + IDEMPOTENCY_TTL_MS
  });
}

export function resetIdempotencyCache(): void {
  cache.clear();
}

