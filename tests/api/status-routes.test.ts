import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMockAdapter, mockAdapter } from "src/apadapters/mock.js";
import { app } from "src/server.js";
import { getInvoiceStatus, resetInvoiceStatusCache, setInvoiceStatus } from "src/history/invoiceStatus.js";
import { flushMetricsTick, renderMetrics, resetMetrics } from "src/metrics.js";
import { resetReplayGuard } from "src/services/replayGuard.js";
import { resetStorage } from "src/storage/index.js";

const API_KEY = "status-test-key";
const AP_SECRET = "test-ap-secret";
let statusDir: string;

function signWebhookPayload(
  payload: Record<string, unknown>,
  overrides?: { eventId?: string; timestamp?: string }
): { body: string; signature: string; eventId: string; timestamp: string } {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", AP_SECRET).update(body).digest("hex");
  return {
    body,
    signature,
    eventId: overrides?.eventId ?? randomUUID(),
    timestamp: overrides?.timestamp ?? new Date().toISOString()
  };
}

describe("AP status routes", () => {
  beforeEach(async () => {
    statusDir = await mkdtemp(path.join(tmpdir(), "vida-status-test-"));
    process.env.VIDA_INVOICE_STATUS_DIR = statusDir;
    process.env.VIDA_API_KEYS = API_KEY;
    process.env.VIDA_AP_ADAPTER = "mock";
    process.env.AP_WEBHOOK_SECRET = AP_SECRET;
    await resetStorage();
    resetInvoiceStatusCache();
    resetMetrics();
    __resetMockAdapter();
    resetReplayGuard();
  });

  afterEach(async () => {
    delete process.env.VIDA_INVOICE_STATUS_DIR;
    delete process.env.VIDA_API_KEYS;
    delete process.env.VIDA_AP_ADAPTER;
    delete process.env.AP_WEBHOOK_SECRET;
    await resetStorage();
    resetInvoiceStatusCache();
    resetMetrics();
    __resetMockAdapter();
    resetReplayGuard();
    if (statusDir) {
      await rm(statusDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("returns stored invoice delivery status", async () => {
    const sendResult = await mockAdapter.send({
      tenant: "tenant-a",
      invoiceId: "INV-001",
      ublXml: "<Invoice />"
    });
    await setInvoiceStatus({
      tenant: "tenant-a",
      invoiceId: "INV-001",
      providerId: sendResult.providerId,
      status: sendResult.status,
      attempts: 1
    });

    const response = await request(app)
      .get("/invoice/INV-001/status")
      .set("x-api-key", API_KEY)
      .set("x-vida-tenant", "tenant-a")
      .expect(200);

    expect(response.body).toEqual({
      status: "queued",
      providerId: "mock-INV-001"
    });
  });

  it("updates delivery status from webhook payload", async () => {
    await setInvoiceStatus({
      tenant: "tenant-a",
      invoiceId: "INV-002",
      providerId: "mock-INV-002",
      status: "queued",
      attempts: 1
    });

    const signed = signWebhookPayload(
      {
        tenant: "tenant-a",
        invoiceId: "INV-002",
        providerId: "mock-INV-002",
        status: "delivered",
        attempts: 3
      },
      { eventId: "evt-status-1" }
    );

    await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-Event-ID", signed.eventId)
      .set("X-Event-Timestamp", signed.timestamp)
      .set("X-AP-Signature", signed.signature)
      .send(signed.body)
      .expect(200);

    const updated = await getInvoiceStatus("tenant-a", "INV-002");
    expect(updated?.status).toBe("delivered");
    expect(updated?.attempts).toBe(3);

    await flushMetricsTick();
    const metrics = await renderMetrics();
    expect(metrics).toMatch(/ap_webhook_ok_total\s+1(\.0+)?/);
  });

  it("refreshes queued delivery status via adapter polling", async () => {
    vi.useFakeTimers();
    try {
      const invoiceId = "INV-QUEUED";
      const sendResult = await mockAdapter.send({
        tenant: "tenant-a",
        invoiceId,
        ublXml: "<Invoice />"
      });
      await setInvoiceStatus({
        tenant: "tenant-a",
        invoiceId,
        providerId: sendResult.providerId,
        status: sendResult.status,
        attempts: 1
      });

      const first = await request(app)
        .get(`/invoice/${invoiceId}/status`)
        .set("x-api-key", API_KEY)
        .set("x-vida-tenant", "tenant-a")
        .expect(200);

      expect(first.body.status).toBe("queued");

      vi.advanceTimersByTime(500);

      const second = await request(app)
        .get(`/invoice/${invoiceId}/status`)
        .set("x-api-key", API_KEY)
        .set("x-vida-tenant", "tenant-a")
        .expect(200);

      expect(second.body.status).toBe("delivered");
    } finally {
      vi.useRealTimers();
    }
  });
});
