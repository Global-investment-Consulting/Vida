const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CacheKey = string;

type CachedSubmission = {
  storedAt: number;
  payload: SubmissionPayload;
};

export type SubmissionPayload = {
  invoiceId: string;
  documentId: string;
  status: string;
  externalReference: string;
};

const cache = new Map<CacheKey, CachedSubmission>();

function buildCacheKey(apiKey: string, idempotencyKey: string): CacheKey {
  return `${apiKey}:${idempotencyKey}`;
}

function pruneExpired(now = Date.now()): void {
  for (const [key, entry] of cache.entries()) {
    if (entry.storedAt <= now - CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}

export function getCachedSubmission(
  apiKey: string,
  idempotencyKey: string,
  now = Date.now()
): SubmissionPayload | null {
  pruneExpired(now);
  const entry = cache.get(buildCacheKey(apiKey, idempotencyKey));
  return entry ? entry.payload : null;
}

export function storeCachedSubmission(
  apiKey: string,
  idempotencyKey: string,
  payload: SubmissionPayload,
  now = Date.now()
): void {
  pruneExpired(now);
  cache.set(buildCacheKey(apiKey, idempotencyKey), {
    storedAt: now,
    payload
  });
}

export function resetPublicApiIdempotency(): void {
  cache.clear();
}
