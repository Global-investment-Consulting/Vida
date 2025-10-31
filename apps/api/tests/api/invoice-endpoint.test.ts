import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "src/server.js";
import * as validation from "src/validation/ubl.js";
import * as historyLogger from "src/history/logger.js";
import { listHistory } from "src/history/logger.js";
import { resetIdempotencyCache } from "src/services/idempotencyCache.js";
import { resetRateLimitBuckets } from "src/middleware/rateLimiter.js";
import { resetMetrics } from "src/metrics.js";
import { resetStorage } from "src/storage/index.js";

const API_KEY = "test-key";
const fixedNow = new Date("2025-02-01T10:00:00.000Z");
const shopifyFixturePath = path.resolve(__dirname, "../connectors/fixtures/shopify-order.json");
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

const invoicePathFor = (invoiceId: string) =>
  path.resolve(process.cwd(), "output", `${invoiceId}.xml`);

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: "INV-2025-0001",
    currency: "EUR",
    issueDate: "2025-02-01",
    buyer: {
      name: "Acme GmbH",
      address: {
        countryCode: "DE"
      }
    },
    supplier: {
      name: "Supplier BV",
      address: {
        countryCode: "BE"
      },
      endpoint: {
        id: "9915:vida",
        scheme: "9915"
      }
    },
    lines: [
      {
        description: "Consulting",
        quantity: 1,
        unitPriceMinor: 5000,
        vatRate: 21
      }
    ],
    ...overrides
  };
}

describe("order webhook to invoice retrieval", () => {
  let historyDir: string;
  const createdFiles: string[] = [];
  let recordHistorySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-"));
    process.env.VIDA_HISTORY_DIR = historyDir;
    process.env.VIDA_API_KEYS = API_KEY;
    await resetStorage();
    recordHistorySpy = vi.spyOn(historyLogger, "recordHistory");
    resetIdempotencyCache();
    resetRateLimitBuckets();
    resetMetrics();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(async () => {
    vi.useRealTimers();
    while (createdFiles.length > 0) {
      const file = createdFiles.pop();
      if (!file) continue;
      await rm(file, { force: true }).catch(() => undefined);
    }
    await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
    delete process.env.VIDA_HISTORY_DIR;
    delete process.env.VIDA_API_KEYS;
    await resetStorage();
    recordHistorySpy.mockRestore();
    resetIdempotencyCache();
    resetRateLimitBuckets();
    resetMetrics();
  });

  it("creates an invoice via webhook and serves it via GET", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    const idempotencyKey = "req-123";

    const postResponse = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    const invoiceId = postResponse.body.invoiceId as string;
    expect(invoiceId).toBe("invoice_2025-02-01T10-00-00-000Z");

    const invoicePath = invoicePathFor(invoiceId);
    createdFiles.push(invoicePath);

    const getResponse = await request(app)
      .get(`/invoice/${invoiceId}`)
      .set("x-api-key", API_KEY)
      .expect(200);

    expect(getResponse.headers["content-type"]).toContain("application/xml");
    expect(getResponse.text).toContain("<Invoice");
    expect(getResponse.text).toContain("<cbc:CustomizationID>");
    expect(getResponse.text).toContain("<cbc:ProfileID>");

    const history = await listHistory();
    let createdRecord = history.find((entry) => entry.invoiceId === invoiceId);
    if (!createdRecord) {
      const fromSpy = recordHistorySpy.mock.calls
        .map(([payload]) => payload as historyLogger.HistoryRecord)
        .find((payload) => payload.invoiceId === invoiceId);
      createdRecord = fromSpy;
    }
    expect(createdRecord?.invoiceId).toBe(invoiceId);
    expect(createdRecord?.status).toBe("ok");

    const replayResponse = await request(app)
      .post("/webhook/order-created")
      .set("x-api-key", API_KEY)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    expect(replayResponse.body.invoiceId).toBe(invoiceId);
  });
});

describe("POST /api/invoice", () => {
  let logDir: string;

  beforeEach(async () => {
    logDir = await mkdtemp(path.join(tmpdir(), "vida-request-log-"));
    process.env.VIDA_API_KEYS = API_KEY;
    process.env.VIDA_INVOICE_REQUEST_LOG_DIR = logDir;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(logDir, { recursive: true, force: true }).catch(() => undefined);
    delete process.env.VIDA_API_KEYS;
    delete process.env.VIDA_INVOICE_REQUEST_LOG_DIR;
  });

  it("returns UBL XML and logs the request on success", async () => {
    const response = await request(app)
      .post("/api/invoice")
      .set("x-api-key", API_KEY)
      .send(buildOrder())
      .expect(200);

    expect(response.headers["content-type"]).toContain("application/xml");
    expect(response.text).toContain("<Invoice");
    expect(response.headers["x-request-id"]).toBeDefined();

    const digest = createHash("sha256").update(response.text).digest("hex");
    const expectedLogPath = path.join(logDir, "2025-02-01.jsonl");
    const logContent = await readFile(expectedLogPath, "utf8");
    const [rawEntry] = logContent.trim().split("\n");
    const entry = JSON.parse(rawEntry) as Record<string, unknown>;

    expect(entry.requestId).toBe(response.headers["x-request-id"]);
    expect(entry.status).toBe("OK");
    expect(entry.xmlSha256).toBe(digest);
    expect(entry.createdAt).toBe("2025-02-01T10:00:00.000Z");
  });

  it("returns 422 with BIS details and logs INVALID status", async () => {
    const validateSpy = vi
      .spyOn(validation, "validateUbl")
      .mockReturnValue({
        ok: false,
        errors: [
          {
            path: "buyerParty.identifier",
            msg: "BuyerParty identifier is required",
            ruleId: "BIS-III-PEPPOL-01"
          }
        ]
      });

    const response = await request(app)
      .post("/api/invoice")
      .set("x-api-key", API_KEY)
      .set("x-vida-tenant", "tenant-123")
      .send(buildOrder())
      .expect(422);

    expect(response.body).toEqual({
      code: "BIS_RULE_VIOLATION",
      message: "BuyerParty identifier is required",
      field: "buyerParty.identifier",
      ruleId: "BIS-III-PEPPOL-01"
    });

    const [[xml]] = validateSpy.mock.calls;
    const expectedDigest = createHash("sha256").update(xml as string).digest("hex");
    const expectedLogPath = path.join(logDir, "2025-02-01.jsonl");
    const logContent = await readFile(expectedLogPath, "utf8");
    const lines = logContent
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const lastEntry = lines.at(-1) ?? {};

    expect(lastEntry.status).toBe("INVALID");
    expect(lastEntry.tenantId).toBe("tenant-123");
    expect(lastEntry.xmlSha256).toBe(expectedDigest);
    expect(lastEntry.createdAt).toBe("2025-02-01T10:00:00.000Z");
  });
});
