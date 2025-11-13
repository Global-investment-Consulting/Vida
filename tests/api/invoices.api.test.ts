import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPublicApiIdempotency } from "src/services/publicApiIdempotency.js";

const PUBLIC_KEY = "public-key";

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

  beforeEach(async () => {
    historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-"));
    process.env.VIDA_HISTORY_DIR = historyDir;
    process.env.VIDA_PUBLIC_API_KEY = PUBLIC_KEY;
    process.env.VIDA_API_KEYS = PUBLIC_KEY;
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
  });

  afterEach(async () => {
    await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
    delete process.env.VIDA_HISTORY_DIR;
    delete process.env.VIDA_PUBLIC_API_KEY;
    delete process.env.VIDA_API_KEYS;
    delete process.env.SCRADA_SUPPLIER_SCHEME;
    delete process.env.SCRADA_SUPPLIER_ID;
    delete process.env.SCRADA_SUPPLIER_VAT;
    delete process.env.SCRADA_SUPPLIER_NAME;
    delete process.env.SCRADA_RECEIVER_PROFILE;
    delete process.env.SCRADA_API_KEY;
    delete process.env.SCRADA_API_PASSWORD;
    delete process.env.SCRADA_COMPANY_ID;
    resetPublicApiIdempotency();
    sendMock.mockReset();
    statusMock.mockReset();
  });

  it("creates invoice, persists artifacts, and refreshes status", async () => {
    const payload = buildPayload();

    const postResponse = await request(app)
      .post("/v0/invoices")
      .set("Authorization", `Bearer ${PUBLIC_KEY}`)
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
      .set("Authorization", `Bearer ${PUBLIC_KEY}`)
      .expect(200);

    expect(getResponse.body.documentId).toBe(documentId);
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it("short-circuits duplicate submissions with the same idempotency key", async () => {
    const payload = buildPayload();
    const idempotencyKey = "idem-123";

    const firstResponse = await request(app)
      .post("/v0/invoices")
      .set("Authorization", `Bearer ${PUBLIC_KEY}`)
      .set("Idempotency-Key", idempotencyKey)
      .send(payload)
      .expect(202);

    expect(firstResponse.headers["x-idempotency-cache"]).toBe("MISS");
    expect(sendMock).toHaveBeenCalledOnce();
    const initialBody = firstResponse.body as Record<string, string>;

    sendMock.mockClear();
    const secondResponse = await request(app)
      .post("/v0/invoices")
      .set("Authorization", `Bearer ${PUBLIC_KEY}`)
      .set("idempotency-key", idempotencyKey)
      .send(payload)
      .expect(202);

    expect(sendMock).not.toHaveBeenCalled();
    expect(secondResponse.headers["x-idempotency-cache"]).toBe("HIT");
    expect(secondResponse.body).toEqual(initialBody);
  });
});
