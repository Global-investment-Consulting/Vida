import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "src/server.js";
import { getInvoiceStatus, resetInvoiceStatusCache } from "src/history/invoiceStatus.js";
import { resetReplayGuard } from "src/services/replayGuard.js";
import { renderMetrics, resetMetrics } from "src/metrics.js";
import { resetStorage } from "src/storage/index.js";

const API_KEY = "webhook-test-key";
const AP_SECRET = "signing-secret";

type Payload = Record<string, unknown>;

function signWebhookPayload(
  payload: Payload,
  overrides?: { eventId?: string; timestamp?: string; signatureEncoder?: (body: string) => string }
): { body: string; signature: string; eventId: string; timestamp: string } {
  const body = JSON.stringify(payload);
  const encoder =
    overrides?.signatureEncoder ??
    ((raw: string) => createHmac("sha256", AP_SECRET).update(raw).digest("hex"));
  return {
    body,
    signature: encoder(body),
    eventId: overrides?.eventId ?? randomUUID(),
    timestamp: overrides?.timestamp ?? new Date().toISOString()
  };
}

describe("AP webhook signing and replay protection", () => {
  let statusDir: string;

  beforeEach(async () => {
    statusDir = await mkdtemp(path.join(tmpdir(), "vida-webhook-status-"));
    process.env.VIDA_INVOICE_STATUS_DIR = statusDir;
    process.env.VIDA_API_KEYS = API_KEY;
    process.env.AP_WEBHOOK_SECRET = AP_SECRET;
    await resetStorage();
    resetInvoiceStatusCache();
    resetReplayGuard();
    resetMetrics();
  });

  afterEach(async () => {
    delete process.env.VIDA_INVOICE_STATUS_DIR;
    delete process.env.VIDA_API_KEYS;
    delete process.env.AP_WEBHOOK_SECRET;
    await resetStorage();
    resetReplayGuard();
    resetInvoiceStatusCache();
    resetMetrics();
    if (statusDir) {
      await rm(statusDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("accepts a valid signed webhook", async () => {
    const signed = signWebhookPayload({
      tenant: "tenant-alpha",
      invoiceId: "INV-SIGN-001",
      providerId: "mock-INV-SIGN-001",
      status: "delivered",
      attempts: 2
    });

    const response = await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-AP-Signature", signed.signature)
      .set("X-Event-ID", signed.eventId)
      .set("X-Event-Timestamp", signed.timestamp)
      .send(signed.body)
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    const record = await getInvoiceStatus("tenant-alpha", "INV-SIGN-001");
    expect(record?.status).toBe("delivered");
    expect(record?.attempts).toBe(2);

    const metrics = renderMetrics();
    expect(metrics).toContain("ap_webhook_ok_total 1");
    expect(metrics).toMatch(/ap_webhook_latency_ms_count 1/);
  });

  it("rejects an invalid signature", async () => {
    const signed = signWebhookPayload({
      tenant: "tenant-beta",
      invoiceId: "INV-SIGN-002",
      providerId: "mock-INV-SIGN-002",
      status: "queued"
    });

    await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-AP-Signature", signed.signature.replace(/^./, (char) => (char === "0" ? "1" : "0")))
      .set("X-Event-ID", signed.eventId)
      .set("X-Event-Timestamp", signed.timestamp)
      .send(signed.body)
      .expect(401);

    const metrics = renderMetrics();
    expect(metrics).toContain("ap_webhook_fail_total 1");
  });

  it("rejects an event with an old timestamp", async () => {
    const signed = signWebhookPayload(
      {
        tenant: "tenant-gamma",
        invoiceId: "INV-SIGN-003",
        providerId: "mock-INV-SIGN-003",
        status: "sent"
      },
      { timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() }
    );

    await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-AP-Signature", signed.signature)
      .set("X-Event-ID", signed.eventId)
      .set("X-Event-Timestamp", signed.timestamp)
      .send(signed.body)
      .expect(401);
  });

  it("rejects when timestamp header is missing", async () => {
    const signed = signWebhookPayload({
      tenant: "tenant-epsilon",
      invoiceId: "INV-SIGN-005",
      providerId: "mock-INV-SIGN-005",
      status: "queued"
    });

    await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-AP-Signature", signed.signature)
      .set("X-Event-ID", signed.eventId)
      .send(signed.body)
      .expect(400);
  });

  it("ignores duplicate event IDs while keeping prior status", async () => {
    const eventId = "evt-duplicate";
    const first = signWebhookPayload(
      {
        tenant: "tenant-delta",
        invoiceId: "INV-SIGN-004",
        providerId: "mock-INV-SIGN-004",
        status: "queued",
        attempts: 1
      },
      { eventId }
    );

    await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-AP-Signature", first.signature)
      .set("X-Event-ID", first.eventId)
      .set("X-Event-Timestamp", first.timestamp)
      .send(first.body)
      .expect(200);

    const second = signWebhookPayload(
      {
        tenant: "tenant-delta",
        invoiceId: "INV-SIGN-004",
        providerId: "mock-INV-SIGN-004",
        status: "error",
        attempts: 5,
        error: "Injected failure"
      },
      { eventId, timestamp: new Date().toISOString() }
    );

    const duplicateResponse = await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .set("Content-Type", "application/json")
      .set("X-AP-Signature", second.signature)
      .set("X-Event-ID", second.eventId)
      .set("X-Event-Timestamp", second.timestamp)
      .send(second.body)
      .expect(200);

    expect(duplicateResponse.body).toEqual({ ok: true, duplicate: true });
    const record = await getInvoiceStatus("tenant-delta", "INV-SIGN-004");
    expect(record?.status).toBe("queued");
    expect(record?.attempts).toBe(1);
  });
});
