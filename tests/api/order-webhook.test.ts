import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "src/server.js";
import * as historyLogger from "src/history/logger.js";
import { listHistory } from "src/history/logger.js";
import { listInvoiceStatuses, resetInvoiceStatusCache } from "src/history/invoiceStatus.js";
import * as validation from "src/validation/ubl.js";
import { resetRateLimitBuckets } from "src/middleware/rateLimiter.js";
import { resetIdempotencyCache } from "src/services/idempotencyCache.js";
import { renderMetrics, resetMetrics } from "src/metrics.js";
import { resetStorage } from "src/storage/index.js";

const shopifyFixturePath = path.resolve(__dirname, "../connectors/fixtures/shopify-order.json");
const wooFixturePath = path.resolve(__dirname, "../connectors/fixtures/woocommerce-order.json");
const API_KEY = "test-key";
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
const fixedDate = new Date("2025-01-22T12:00:00.000Z");
const invoiceFilePath = (invoiceId: string) =>
  path.resolve(process.cwd(), "output", `${invoiceId}.xml`);
let historyDir: string;
let statusDir: string;
let recordHistorySpy: ReturnType<typeof vi.spyOn>;
let validateUblSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(async () => {
  historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-"));
  statusDir = await mkdtemp(path.join(tmpdir(), "vida-status-"));
  process.env.VIDA_HISTORY_DIR = historyDir;
  process.env.VIDA_INVOICE_STATUS_DIR = statusDir;
  process.env.VIDA_API_KEYS = API_KEY;
  await resetStorage();
  recordHistorySpy = vi.spyOn(historyLogger, "recordHistory");
  validateUblSpy = undefined;
  resetIdempotencyCache();
  resetRateLimitBuckets();
  resetMetrics();
  resetInvoiceStatusCache();
  vi.useFakeTimers();
  vi.setSystemTime(fixedDate);
});

afterEach(async () => {
  vi.useRealTimers();
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
  recordHistorySpy.mockRestore();
  if (validateUblSpy) {
    validateUblSpy.mockRestore();
    validateUblSpy = undefined;
  }
  delete process.env.VIDA_HISTORY_DIR;
  delete process.env.VIDA_API_KEYS;
  delete process.env.VIDA_INVOICE_STATUS_DIR;
  delete process.env.VIDA_AP_SEND_ON_CREATE;
  delete process.env.VIDA_AP_ADAPTER;
  await resetStorage();
  delete process.env.VIDA_VALIDATE_UBL;
  resetIdempotencyCache();
  resetRateLimitBuckets();
  resetMetrics();
  resetInvoiceStatusCache();
});

describe("POST /webhook/order-created", () => {
  it("normalises a Shopify order, creates XML, and returns the file path", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    expect(response.body).toEqual({
      invoiceId: "invoice_2025-01-22T12-00-00-000Z"
    });

    const generatedPath = invoiceFilePath(response.body.invoiceId);
    createdFiles.push(generatedPath);
    const stats = await stat(generatedPath);
    expect(stats.isFile()).toBe(true);
    const xml = await readFile(generatedPath, "utf8");
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml.includes("<Invoice")).toBe(true);

    const history = await listHistory();
    let createdEntry = history.find((entry) => entry.invoiceId === response.body.invoiceId);
    if (!createdEntry) {
      const fromSpy = recordHistorySpy.mock.calls
        .map(([payload]) => payload as historyLogger.HistoryRecord)
        .find((payload) => payload.invoiceId === response.body.invoiceId);
      createdEntry = fromSpy;
    }
    expect(createdEntry).toBeDefined();
    expect(createdEntry?.status).toBe("ok");
    expect(createdEntry?.invoiceId).toBe(response.body.invoiceId);
    expect(createdEntry?.invoicePath).toBe(invoiceFilePath(response.body.invoiceId));
    expect(createdEntry?.source).toBe("shopify");
  });

  it("normalises a WooCommerce order, creates XML, and returns the file path", async () => {
    const payload = JSON.parse(await readFile(wooFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "woocommerce",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    expect(response.body.invoiceId).toBe("invoice_2025-01-22T12-00-00-000Z");

    const generatedPath = invoiceFilePath(response.body.invoiceId);
    createdFiles.push(generatedPath);
    const xml = await readFile(generatedPath, "utf8");
    expect(xml.includes("<cac:InvoiceLine>")).toBe(true);

    const history = await listHistory();
    let woocommerceEntry = history.find((entry) => entry.invoiceId === response.body.invoiceId);
    if (!woocommerceEntry) {
      const fromSpy = recordHistorySpy.mock.calls
        .map(([payload]) => payload as historyLogger.HistoryRecord)
        .find((payload) => payload.invoiceId === response.body.invoiceId);
      woocommerceEntry = fromSpy;
    }
    expect(woocommerceEntry).toBeDefined();
    expect(woocommerceEntry?.status).toBe("ok");
    expect(woocommerceEntry?.source).toBe("woocommerce");
    expect(woocommerceEntry?.invoiceId).toBe(response.body.invoiceId);
  });

  it("sends the invoice via the AP adapter when enabled", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    process.env.VIDA_AP_SEND_ON_CREATE = "true";
    process.env.VIDA_AP_ADAPTER = "mock";

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    const invoiceIdResponse = response.body.invoiceId as string;
    const statuses = await listInvoiceStatuses();
    const createdStatus = statuses.find((status) => status.invoiceId === invoiceIdResponse);
    expect(createdStatus).toMatchObject({
      status: "queued",
      providerId: `mock-${invoiceIdResponse}`,
      attempts: 1
    });

    const metricsOutput = renderMetrics();
    expect(metricsOutput).toContain("ap_send_attempts_total 1");
    expect(metricsOutput).toContain("ap_send_success_total 1");
    const pendingCount = statuses.filter((status) => status.status === "queued" || status.status === "sent").length;
    expect(metricsOutput).toContain(`ap_queue_current ${pendingCount}`);

    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ok",
        peppolStatus: "queued",
        peppolId: `mock-${invoiceIdResponse}`,
        invoiceId: invoiceIdResponse
      })
    );
  });

  it("rejects invalid payloads", async () => {
    await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({ source: "shopify" })
      .expect(400);

    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "payload is required" })
    );
  });

  it("returns 422 when mapper preconditions fail", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "shopify",
        payload
      })
      .expect(422);

    expect(response.body.error).toMatch(/supplier/i);
    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: expect.stringMatching(/supplier/i) })
    );
  });

  it("returns 401 when API key is missing", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    await request(app)
      .post("/webhook/order-created")
      .send({
        source: "shopify",
        payload,
        supplier
      })
      .expect(401);

    expect(recordHistorySpy).not.toHaveBeenCalled();
  });

  it("returns 401 when API key is invalid", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", "wrong-key")
      .send({
        source: "shopify",
        payload,
        supplier
      })
      .expect(401);

    expect(recordHistorySpy).not.toHaveBeenCalled();
  });

  it("validates UBL when flag enabled", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    process.env.VIDA_VALIDATE_UBL = "true";
    validateUblSpy = vi.spyOn(validation, "validateUbl");

    await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    expect(validateUblSpy).toHaveBeenCalled();
    const history = await listHistory();
    expect(history[0]?.validationErrors).toBeUndefined();
  });

  it("returns 422 when UBL validation fails", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    process.env.VIDA_VALIDATE_UBL = "true";
    validateUblSpy = vi.spyOn(validation, "validateUbl").mockReturnValue({
      ok: false,
      errors: [{ path: "/", msg: "Invalid UBL" }]
    });

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(422);

    expect(response.body.error).toBe("UBL validation failed");
    expect(response.body.details).toEqual([{ path: "/", msg: "Invalid UBL" }]);
    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        validationErrors: [{ path: "/", msg: "Invalid UBL" }]
      })
    );
  });

  it("returns cached invoice ids for duplicate idempotency keys", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    const idemKey = "cache-me";

    const firstResponse = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .set("Idempotency-Key", idemKey)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    const firstInvoiceId = firstResponse.body.invoiceId as string;
    expect(firstResponse.headers["x-idempotency-cache"]).toBe("MISS");
    const firstPath = invoiceFilePath(firstInvoiceId);
    createdFiles.push(firstPath);
    const statInfo = await stat(firstPath);
    expect(statInfo.isFile()).toBe(true);

    const secondResponse = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .set("Idempotency-Key", idemKey)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    expect(secondResponse.body.invoiceId).toBe(firstInvoiceId);
    expect(secondResponse.headers["x-idempotency-cache"]).toBe("HIT");

    const history = await listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.invoiceId).toBe(firstInvoiceId);
  });

  it("applies rate limiting per API key", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    for (let index = 0; index < 60; index += 1) {
      const response = await request(app)
        .post("/webhook/order-created")
        .set("x-api-key", API_KEY)
        .send({
          source: "shopify",
          payload,
          supplier,
          defaultVatRate: 21
        })
        .expect(200);
      const invoiceId = response.body.invoiceId as string;
      createdFiles.push(invoiceFilePath(invoiceId));
      vi.advanceTimersByTime(10);
    }

    const throttled = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(429);

    expect(throttled.body.error).toMatch(/rate limit/i);
    expect(throttled.headers["x-ratelimit-remaining"]).toBe("0");

    vi.advanceTimersByTime(60_000);

    const resetResponse = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    const resetInvoiceId = resetResponse.body.invoiceId as string;
    createdFiles.push(invoiceFilePath(resetInvoiceId));
  });
});
