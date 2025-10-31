import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "src/server.js";
import { listInvoiceStatuses, resetInvoiceStatusCache } from "src/history/invoiceStatus.js";
import { resetRateLimitBuckets } from "src/middleware/rateLimiter.js";
import { resetIdempotencyCache } from "src/services/idempotencyCache.js";
import { flushMetricsTick, renderMetrics, resetMetrics } from "src/metrics.js";
import { getStorage, resetStorage } from "src/storage/index.js";

const shopifyFixturePath = path.resolve(__dirname, "../connectors/fixtures/shopify-order.json");
const API_KEY = "retry-test-key";
const supplier = {
  name: "Supplier BV",
  registrationName: "Supplier BV",
  vatId: "BE0123456789",
  address: {
    streetName: "Rue Exemple 1",
    cityName: "Brussels",
    postalZone: "1000",
    countryCode: "BE"
  },
  contact: {
    electronicMail: "invoices@supplier.example"
  }
};

const createdFiles: string[] = [];
let historyDir: string;
let statusDir: string;
let dlqDir: string;

describe("AP send retries and DLQ", () => {
  beforeEach(async () => {
    historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-"));
    statusDir = await mkdtemp(path.join(tmpdir(), "vida-status-"));
    dlqDir = await mkdtemp(path.join(tmpdir(), "vida-dlq-"));
    process.env.VIDA_HISTORY_DIR = historyDir;
    process.env.VIDA_INVOICE_STATUS_DIR = statusDir;
    process.env.VIDA_DLQ_PATH = path.join(dlqDir, "dlq.jsonl");
    process.env.VIDA_API_KEYS = API_KEY;
    process.env.VIDA_AP_ADAPTER = "mock_error";
    process.env.VIDA_AP_SEND_ON_CREATE = "true";
    await resetStorage();
    resetInvoiceStatusCache();
    resetIdempotencyCache();
    resetRateLimitBuckets();
    resetMetrics();
  });

  afterEach(async () => {
    while (createdFiles.length > 0) {
      const file = createdFiles.pop();
      if (!file) continue;
      await rm(file, { force: true }).catch(() => undefined);
    }
    if (historyDir) {
      await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (statusDir) {
      await rm(statusDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (dlqDir) {
      await rm(dlqDir, { recursive: true, force: true }).catch(() => undefined);
    }
    delete process.env.VIDA_HISTORY_DIR;
    delete process.env.VIDA_INVOICE_STATUS_DIR;
    delete process.env.VIDA_DLQ_PATH;
    delete process.env.VIDA_API_KEYS;
    delete process.env.VIDA_AP_ADAPTER;
    delete process.env.VIDA_AP_SEND_ON_CREATE;
    await resetStorage();
    resetInvoiceStatusCache();
    resetIdempotencyCache();
    resetRateLimitBuckets();
    resetMetrics();
  });

  it("retries failed sends and writes DLQ entry on final failure", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    const responsePromise = request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .set("x-vida-tenant", "tenant-retry")
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(502);

    const response = await responsePromise;

    expect(response.body).toHaveProperty("error");
    expect(String(response.body.error)).toMatch(/AP send failed/i);

    const statuses = await listInvoiceStatuses();
    expect(statuses).toHaveLength(1);
    const record = statuses[0];
    expect(record.status).toBe("error");
    expect(record.attempts).toBe(5);
    expect(record.lastError).toMatch(/Mock adapter forced failure/);

    const expectedInvoicePath = path.resolve(
      process.cwd(),
      "output",
      `${record.invoiceId}.xml`
    );
    const stats = await stat(expectedInvoicePath);
    expect(stats.isFile()).toBe(true);
    createdFiles.push(expectedInvoicePath);

    await flushMetricsTick();
    const metrics = await renderMetrics();
    expect(metrics).toMatch(/ap_send_attempts_total\s+5(\.0+)?/);
    expect(metrics).toMatch(/ap_send_fail_total\s+1(\.0+)?/);
    expect(metrics).toMatch(/ap_send_success_total\s+0(\.0+)?/);
    expect(metrics).toMatch(/ap_queue_current\s+0(\.0+)?/);

    const backend = (process.env.VIDA_STORAGE_BACKEND ?? "file").toLowerCase();
    if (backend === "prisma") {
      const storage = getStorage();
      if (typeof storage.dlq.count === "function") {
        const dlqCount = await storage.dlq.count();
        expect(dlqCount).toBeGreaterThanOrEqual(1);
      }
    } else {
      const dlqPath = path.join(dlqDir, "dlq.jsonl");
      const dlqContent = await readFile(dlqPath, "utf8");
      const lines = dlqContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]) as {
        invoiceId: string;
        tenant: string | null;
        error: string;
      };
      expect(entry.invoiceId).toBe(record.invoiceId);
      expect(entry.tenant).toBe("tenant-retry");
      expect(entry.error).toMatch(/Mock adapter forced failure/);
    }
  }, 20000);
});
