import type { NextFunction, Request, Response } from "express";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimiterOptions = {
  limit: number;
  windowMs: number;
};

const buckets = new Map<string, RateLimitBucket>();

function getApiKeyFromLocals(res: Response): string | undefined {
  const value = res.locals.apiKey;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function createApiKeyRateLimiter(options: RateLimiterOptions) {
  const { limit, windowMs } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = getApiKeyFromLocals(res);

    if (!apiKey || limit <= 0 || windowMs <= 0) {
      next();
      return;
    }

    const now = Date.now();
    const existing = buckets.get(apiKey);

    if (!existing || now >= existing.resetAt) {
      buckets.set(apiKey, { count: 1, resetAt: now + windowMs });
      setHeaders(res, { limit, remaining: limit - 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= limit) {
      setHeaders(res, { limit, remaining: 0, resetAt: existing.resetAt });
      res.status(429).json({ error: "rate limit exceeded" });
      return;
    }

    existing.count += 1;
    setHeaders(res, { limit, remaining: limit - existing.count, resetAt: existing.resetAt });
    next();
  };
}

type HeaderOptions = {
  limit: number;
  remaining: number;
  resetAt: number;
};

function setHeaders(res: Response, options: HeaderOptions): void {
  res.setHeader("X-RateLimit-Limit", options.limit.toString());
  res.setHeader("X-RateLimit-Remaining", Math.max(options.remaining, 0).toString());
  res.setHeader("X-RateLimit-Reset", Math.ceil(options.resetAt / 1000).toString());
}

export function resetRateLimitBuckets(): void {
  buckets.clear();
}

