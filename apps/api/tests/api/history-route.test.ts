import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "src/server.js";
import { recordHistory } from "src/history/logger.js";
import { resetIdempotencyCache } from "src/services/idempotencyCache.js";
import { resetRateLimitBuckets } from "src/middleware/rateLimiter.js";
import { resetMetrics } from "src/metrics.js";
import { resetStorage } from "src/storage/index.js";

const API_KEY = "test-key";

describe("GET /history", () => {
  let historyDir: string;

  beforeEach(async () => {
    historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-route-"));
    process.env.VIDA_HISTORY_DIR = historyDir;
    process.env.VIDA_API_KEYS = API_KEY;
    await resetStorage();
    resetIdempotencyCache();
    resetRateLimitBuckets();
    resetMetrics();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    resetIdempotencyCache();
    resetRateLimitBuckets();
    resetMetrics();
    await resetStorage();
    delete process.env.VIDA_HISTORY_DIR;
    delete process.env.VIDA_API_KEYS;
    await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("requires authentication", async () => {
    await request(app).get("/history").expect(401);
  });

  it("returns recent history entries and supports tenant filtering", async () => {
    await recordHistory({
      requestId: "req-1",
      timestamp: "2025-01-01T10:00:00.000Z",
      source: "shopify",
      orderNumber: "1001",
      tenantId: "tenant-a",
      status: "ok",
      durationMs: 120
    });

    await recordHistory({
      requestId: "req-2",
      timestamp: "2025-01-01T11:00:00.000Z",
      source: "woocommerce",
      orderNumber: "1002",
      tenantId: "tenant-b",
      status: "error",
      error: "validation failed",
      durationMs: 200
    });

    const response = await request(app)
      .get("/history")
      .set("x-api-key", API_KEY)
      .expect(200);

    expect(response.body.history.some((entry: { requestId: string }) => entry.requestId === "req-1")).toBe(true);
    expect(response.body.history.some((entry: { requestId: string }) => entry.requestId === "req-2")).toBe(true);
    const req2Index = response.body.history.findIndex((entry: { requestId: string }) => entry.requestId === "req-2");
    const req1Index = response.body.history.findIndex((entry: { requestId: string }) => entry.requestId === "req-1");
    expect(req2Index).toBeGreaterThan(-1);
    expect(req1Index).toBeGreaterThan(-1);
    expect(req2Index).toBeLessThan(req1Index);

    const filteredResponse = await request(app)
      .get("/history?tenant=tenant-a")
      .set("x-api-key", API_KEY)
      .expect(200);

    expect(filteredResponse.body.history.some((entry: { tenantId?: string }) => entry.tenantId === "tenant-a")).toBe(true);
  });
});
