import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSubmissionsStoreCache } from "../../src/services/submissionsStore.js";
import { resetRateLimitBuckets } from "../../src/middleware/rateLimiter.js";

process.env.VIDA_PUBLIC_RATE_LIMIT = "5";
process.env.VIDA_PUBLIC_RATE_LIMIT_WINDOW_MS = "60000";

const PUBLIC_KEY = "public-key";
const ADMIN_KEY = "operator-admin";
const TENANT_KEY = `tenant-a:${PUBLIC_KEY}`;

process.env.OPS_DASHBOARD_ENABLED = "true";
process.env.ADMIN_DASHBOARD_KEY = ADMIN_KEY;

async function resetAllSubmissionStores(): Promise<void> {
  resetSubmissionsStoreCache();
  try {
    const distModule = await import("../../dist/src/services/submissionsStore.js");
    if (typeof distModule.resetSubmissionsStoreCache === "function") {
      distModule.resetSubmissionsStoreCache();
    }
  } catch {
    // dist build not present or not yet generated
  }
}

async function resetAllRateLimitBuckets(): Promise<void> {
  resetRateLimitBuckets();
  try {
    const distModule = await import("../../dist/src/middleware/rateLimiter.js");
    if (typeof distModule.resetRateLimitBuckets === "function") {
      distModule.resetRateLimitBuckets();
    }
  } catch {
    // dist build not present or not yet generated
  }
}

const { sendMock, statusMock, httpClient } = vi.hoisted(() => {
  const mockClient = {
    post: vi.fn().mockResolvedValue({ data: "\"doc-http\"" }),
    get: vi.fn().mockResolvedValue({ data: { documentId: "doc-http", status: "Delivered" } })
  };
  return {
    sendMock: vi.fn(),
    statusMock: vi.fn(),
    httpClient: mockClient
  };
});

vi.mock("../../apps/api/src/lib/http.ts", () => ({
  getScradaClient: () => httpClient
}));
vi.mock("../../apps/api/dist/src/lib/http.js", () => ({
  getScradaClient: () => httpClient
}));
vi.mock("../../src/services/scradaClient.js", () => ({
  sendInvoiceThroughScrada: sendMock,
  fetchScradaStatus: statusMock
}));
vi.mock("../../dist/src/services/scradaClient.js", () => ({
  sendInvoiceThroughScrada: sendMock,
  fetchScradaStatus: statusMock
}));

let app: Express;

beforeAll(async () => {
  const mod = await import("src/server.js");
  app = mod.app;
});

afterAll(() => {
  vi.resetModules();
});

function buildPayload() {
  return {
    externalReference: "INV-2025-0001",
    currency: "EUR",
    issueDate: "2025-02-01",
    seller: {
      name: "Vida Supplier BV",
      vatId: "BE0755799452",
      endpoint: { scheme: "0208", id: "0755799452" }
    },
    buyer: {
      name: "Acme GmbH",
      endpoint: { scheme: "0208", id: "0999999999" }
    },
    lines: [
      {
        description: "Consulting",
        quantity: 1,
        unitPriceMinor: 500000,
        vatRate: 21
      }
    ]
  };
}

describe("v0 invoices API", () => {
  let historyDir: string;
  let submissionsDir: string;

  beforeEach(async () => {
    historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-"));
    submissionsDir = await mkdtemp(path.join(tmpdir(), "vida-submissions-"));
    process.env.VIDA_HISTORY_DIR = historyDir;
    process.env.VIDA_PUBLIC_API_STORE_DIR = submissionsDir;
    process.env.VIDA_API_KEYS = `${TENANT_KEY},${ADMIN_KEY}`;
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_ID = "0755799452";
    process.env.SCRADA_SUPPLIER_VAT = "BE0755799452";
    process.env.SCRADA_SUPPLIER_NAME = "Vida Supplier BV";
    process.env.SCRADA_RECEIVER_PROFILE = "0208";
    process.env.SCRADA_API_KEY = "test-key";
    process.env.SCRADA_API_PASSWORD = "test-password";
    process.env.SCRADA_COMPANY_ID = "VIDA-COMPANY";
    httpClient.post.mockClear();
    httpClient.get.mockClear();
    sendMock.mockImplementation(async ({ invoiceId, externalReference }) => ({
      invoice: {} as never,
      documentId: `doc-${invoiceId}`,
      invoiceId,
      externalReference: externalReference ?? invoiceId,
      vatVariant: "BE0755799452",
      channel: "json",
      headerSweep: false,
      docValueIndex: null,
      processValueIndex: null,
      attempts: [
        {
          attempt: 1,
          channel: "json",
          vatVariant: "BE0755799452",
          success: true
        }
      ],
      artifacts: {
        directory: "",
        jsonPath: "",
        ublPath: "",
        ublHeadersPath: "",
        errorPath: ""
      }
    }));
    statusMock.mockImplementation(async (documentId: string) => ({
      documentId,
      status: "Delivered"
    }));
    await resetAllSubmissionStores();
    await resetAllRateLimitBuckets();
  });

  afterEach(async () => {
    await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(submissionsDir, { recursive: true, force: true }).catch(() => undefined);
    delete process.env.VIDA_HISTORY_DIR;
    delete process.env.VIDA_PUBLIC_API_STORE_DIR;
    delete process.env.VIDA_API_KEYS;
    delete process.env.SCRADA_SUPPLIER_SCHEME;
    delete process.env.SCRADA_SUPPLIER_ID;
    delete process.env.SCRADA_SUPPLIER_VAT;
    delete process.env.SCRADA_SUPPLIER_NAME;
    delete process.env.SCRADA_RECEIVER_PROFILE;
    delete process.env.SCRADA_API_KEY;
    delete process.env.SCRADA_API_PASSWORD;
    delete process.env.SCRADA_COMPANY_ID;
    sendMock.mockReset();
    statusMock.mockReset();
    await resetAllSubmissionStores();
    await resetAllRateLimitBuckets();
  });

  it("returns 401 when api key is missing", async () => {
    const payload = buildPayload();
    await request(app).post("/v0/invoices").send(payload).expect(401);
  });

  it("returns 401 when api key is invalid", async () => {
    const payload = buildPayload();
    await request(app)
      .post("/v0/invoices")
      .set("X-Api-Key", "wrong-key")
      .send(payload)
      .expect(401);
  });

  it("returns 400 when idempotency key is missing", async () => {
    const payload = buildPayload();
    await request(app)
      .post("/v0/invoices")
      .set("X-Api-Key", PUBLIC_KEY)
      .send(payload)
      .expect(400);
  });

  it("enforces per-key rate limits", async () => {
    const payload = buildPayload();
    for (let i = 0; i <= 5; i += 1) {
      await request(app)
        .post("/v0/invoices")
        .set("X-Api-Key", PUBLIC_KEY)
        .set("Idempotency-Key", `rk-${i}`)
        .send(payload)
        .expect(i === 5 ? 429 : 202);
    }
  });

  it("exposes submissions feed and allows resends", async () => {
    const payload = buildPayload();
    const postResponse = await request(app)
      .post("/v0/invoices")
      .set("X-Api-Key", PUBLIC_KEY)
      .set("Idempotency-Key", "dashboard-list")
      .send(payload)
      .expect(202);

    const listResponse = await request(app)
      .get("/ops/submissions")
      .set("X-Admin-Key", ADMIN_KEY)
      .expect(200);

    expect(Array.isArray(listResponse.body.items)).toBe(true);
    expect(listResponse.body.items.length).toBeGreaterThan(0);

    const targetInvoiceId = postResponse.body.invoiceId;
    const originalNodeEnv = process.env.NODE_ENV;
    let resendResponse;
    process.env.NODE_ENV = "staging";
    try {
      resendResponse = await request(app)
        .post(`/ops/submissions/${targetInvoiceId}/resend`)
        .set("X-Admin-Key", ADMIN_KEY)
        .expect(202);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }

    expect(resendResponse.body).toHaveProperty("invoiceId");
    expect(resendResponse.body.invoiceId).not.toBe(targetInvoiceId);
  });

  it("short-circuits duplicate submissions with the same idempotency key", async () => {
    const payload = buildPayload();

    const firstResponse = await request(app)
      .post("/v0/invoices")
      .set("X-Api-Key", PUBLIC_KEY)
      .set("Idempotency-Key", "dup-key-1")
      .send(payload)
      .expect(202);

    const secondResponse = await request(app)
      .post("/v0/invoices")
      .set("X-Api-Key", PUBLIC_KEY)
      .set("Idempotency-Key", "dup-key-1")
      .send(payload)
      .expect(200);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(secondResponse.body).toMatchObject({
      invoiceId: firstResponse.body.invoiceId,
      documentId: firstResponse.body.documentId,
      status: firstResponse.body.status
    });
  });

  it("creates invoice, persists artifacts, and refreshes status", async () => {
    const payload = buildPayload();

    const postResponse = await request(app)
      .post("/v0/invoices")
      .set("X-Api-Key", PUBLIC_KEY)
      .set("Idempotency-Key", "idem-primary")
      .send(payload)
      .expect(202);

    expect(sendMock).toHaveBeenCalledOnce();
    const { invoiceId, documentId, status } = postResponse.body as Record<string, string>;
    expect(invoiceId).toMatch(/^0/);
    expect(documentId).toBe(`doc-${invoiceId}`);
    expect(["DELIVERED", "PENDING"]).toContain(status);

    const requestPath = path.join(historyDir, invoiceId, "request.json");
    const sendPath = path.join(historyDir, invoiceId, "send.json");
    const statusPath = path.join(historyDir, invoiceId, "status.json");
    const patchedPath = path.join(historyDir, invoiceId, "patched.xml");

    const requestContent = JSON.parse(await readFile(requestPath, "utf8")) as Record<string, unknown>;
    expect(requestContent.payload).toMatchObject(payload);

    const sendContent = JSON.parse(await readFile(sendPath, "utf8")) as Record<string, unknown>;
    expect(sendContent.documentId).toBe(documentId);

    const statusContent = JSON.parse(await readFile(statusPath, "utf8")) as Record<string, unknown>;
    expect(statusContent.documentId).toBe(documentId);

    const patchedXml = await readFile(patchedPath, "utf8");
    expect(patchedXml).toContain("<Invoice");

    const getResponse = await request(app)
      .get(`/v0/invoices/${invoiceId}`)
      .set("X-Api-Key", PUBLIC_KEY)
      .expect(200);

    expect(getResponse.body.documentId).toBe(documentId);
    expect(statusMock).toHaveBeenCalledTimes(2);
  });
});
