import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "src/server.js";
import {
  getInvoiceStatus,
  resetInvoiceStatusCache,
  setInvoiceStatus
} from "src/history/invoiceStatus.js";
import { renderMetrics, resetMetrics } from "src/metrics.js";

const API_KEY = "status-test-key";
let statusDir: string;

describe("AP status routes", () => {
  beforeEach(async () => {
    statusDir = await mkdtemp(path.join(tmpdir(), "vida-status-test-"));
    process.env.VIDA_INVOICE_STATUS_DIR = statusDir;
    process.env.VIDA_API_KEYS = API_KEY;
    resetInvoiceStatusCache();
    resetMetrics();
  });

  afterEach(async () => {
    delete process.env.VIDA_INVOICE_STATUS_DIR;
    delete process.env.VIDA_API_KEYS;
    resetInvoiceStatusCache();
    resetMetrics();
    if (statusDir) {
      await rm(statusDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("returns stored invoice delivery status", async () => {
    await setInvoiceStatus({
      tenant: "tenant-a",
      invoiceId: "INV-001",
      providerId: "mock-INV-001",
      status: "queued",
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

    await request(app)
      .post("/ap/status-webhook")
      .set("x-api-key", API_KEY)
      .send({
        tenant: "tenant-a",
        invoiceId: "INV-002",
        providerId: "mock-INV-002",
        status: "delivered",
        attempts: 3
      })
      .expect(200);

    const updated = await getInvoiceStatus("tenant-a", "INV-002");
    expect(updated?.status).toBe("delivered");
    expect(updated?.attempts).toBe(3);

    const metrics = renderMetrics();
    expect(metrics).toContain("ap_webhook_ok_total 1");
  });
});
