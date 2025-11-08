import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billitAdapter, resetBillitAuthCache } from "src/apadapters/billit.js";
import { getAdapter } from "src/apadapters/index.js";
import { sendWithRetry } from "src/services/apDelivery.js";
import { resetInvoiceStatusCache } from "src/history/invoiceStatus.js";
import { getStorage, resetStorage } from "src/storage/index.js";
import type { Order } from "src/peppol/convert.js";

const BASE_URL = "https://billit.test";
const REGISTRATION_ID = "123456";
const originalFetch = globalThis.fetch;

function buildOrder(): Order {
  return {
    orderNumber: "INV-001",
    currency: "EUR",
    currencyMinorUnit: 2,
    issueDate: new Date("2025-01-01T00:00:00.000Z"),
    buyer: {
      name: "Buyer BV",
      vatId: "BE0123456789"
    },
    supplier: {
      name: "Supplier BV",
      vatId: "BE0987654321"
    },
    lines: [
      {
        description: "Sandbox service",
        quantity: 1,
        unitPriceMinor: 1_000,
        vatRate: 21
      }
    ],
    defaultVatRate: 21
  } satisfies Order;
}

describe("billit adapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.AP_BASE_URL = BASE_URL;
    process.env.AP_REGISTRATION_ID = REGISTRATION_ID;
    await resetStorage();
    resetInvoiceStatusCache();
    resetBillitAuthCache();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    resetBillitAuthCache();
    delete process.env.AP_BASE_URL;
    delete process.env.AP_API_KEY;
    delete process.env.AP_CLIENT_ID;
    delete process.env.AP_CLIENT_SECRET;
    delete process.env.AP_REGISTRATION_ID;
    delete process.env.VIDA_DLQ_PATH;
    delete process.env.VIDA_INVOICE_STATUS_DIR;
    await resetStorage();
    resetInvoiceStatusCache();
    vi.useRealTimers();
  });

  it("registers via getAdapter", () => {
    const adapter = getAdapter("billit");
    expect(adapter.name).toBe("billit");
  });

  it("sends invoice with API key authentication", async () => {
    const apiKey = "test-api-key";
    process.env.AP_API_KEY = apiKey;
    const order = buildOrder();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ OrderID: "billit-123", status: "received" }),
        {
          status: 201,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const result = await billitAdapter.send({
      tenant: "acme",
      invoiceId: order.orderNumber,
      ublXml: "<Invoice />",
      order
    });

    expect(result).toEqual({
      providerId: "billit-123",
      status: "queued",
      message: undefined
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe(`${BASE_URL}/v1/commands/send`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers).toBeDefined();
    if (headers) {
      expect(headers.ApiKey ?? headers.apiKey ?? headers.apikey).toBe(apiKey);
      expect(headers["Content-Type"] ?? headers["content-type"]).toBe("application/json");
      expect(headers.Accept ?? headers.accept).toBe("application/json");
    }
    const body = init?.body as string | undefined;
    expect(body).toBeDefined();
    if (body) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      expect(parsed.registrationId).toBe(REGISTRATION_ID);
      expect(parsed.transportType).toBe("Peppol");
      const documents = Array.isArray(parsed.documents) ? parsed.documents : [];
      expect(documents).not.toHaveLength(0);
      const firstDocument = asRecord(documents[0] as Record<string, unknown>);
      expect(firstDocument?.invoiceNumber).toBe(order.orderNumber);
      const docLines = Array.isArray(firstDocument?.lines) ? firstDocument?.lines : [];
      expect(docLines).not.toHaveLength(0);
      const firstLine = asRecord(docLines[0] as Record<string, unknown>);
      expect(firstLine?.unitPrice).toBeCloseTo(10, 6);
    }
  });

  it("sends invoice with OAuth client credentials when API key missing", async () => {
    process.env.AP_CLIENT_ID = "client-id";
    process.env.AP_CLIENT_SECRET = "client-secret";
    const order = buildOrder();
    order.orderNumber = "INV-002";

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "oauth-token", token_type: "Bearer", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ OrderID: "billit-456", status: "submitted" }),
          { status: 202, headers: { "content-type": "application/json" } }
        )
      );

    const result = await billitAdapter.send({
      tenant: "acme",
      invoiceId: order.orderNumber,
      ublXml: "<Invoice />",
      order
    });

    expect(result).toEqual({
      providerId: "billit-456",
      status: "sent",
      message: undefined
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe(`${BASE_URL}/oauth/token`);
    expect(tokenInit?.method).toBe("POST");
    expect(tokenInit?.body).toBe(
      "grant_type=client_credentials&client_id=client-id&client_secret=client-secret"
    );

    const [sendUrl, sendInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(sendUrl).toBe(`${BASE_URL}/v1/commands/send`);
    const headers = sendInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization ?? headers?.authorization).toBe("Bearer oauth-token");
  });

  it("maps provider status to delivered on status fetch", async () => {
    const apiKey = "test-status-key";
    process.env.AP_API_KEY = apiKey;

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          OrderID: "billit-789",
          CurrentDocumentDeliveryDetails: {
            DocumentDeliveryStatus: "Delivered"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const status = await billitAdapter.getStatus("billit-789");
    expect(status).toBe("delivered");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${BASE_URL}/v1/einvoices/registrations/${REGISTRATION_ID}/orders/billit-789`
    );
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.ApiKey ?? headers?.apiKey ?? headers?.apikey).toBe(apiKey);
  });

  it("retries on send failure and writes to DLQ after max attempts", async () => {
    const apiKey = "retry-key";
    process.env.AP_API_KEY = apiKey;

    const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "billit-tests-"));
    const dlqPath = path.join(tmpRoot, "dlq.jsonl");
    const statusDir = path.join(tmpRoot, "status");
    process.env.VIDA_DLQ_PATH = dlqPath;
    process.env.VIDA_INVOICE_STATUS_DIR = statusDir;
    resetInvoiceStatusCache();
    const order = buildOrder();
    order.orderNumber = "INV-ERR";

    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({ error: "bad_gateway" }),
        {
          status: 502,
          headers: { "content-type": "application/json" }
        }
      )
    );

    await expect(
      sendWithRetry({
        tenant: "acme",
        invoiceId: "INV-ERR",
        ublXml: "<Invoice />",
        requestId: "req-err",
        adapterName: "billit",
        logger: {
          info: () => {},
          error: () => {}
        },
        order
      })
    ).rejects.toThrow(/Billit send failed/);

    const fetchTargets = fetchMock.mock.calls.map(([input]) => {
      if (typeof input === "string") {
        return input;
      }
      if (input && typeof input === "object" && "url" in input && typeof (input as { url?: unknown }).url === "string") {
        return (input as { url: string }).url;
      }
      return String(input);
    });
    const sendCalls = fetchTargets.filter((url) => url.includes("/v1/commands/send"));
    expect(sendCalls).toHaveLength(5);
    const registrationCalls = fetchTargets.filter((url) => url.includes("/registrations"));
    expect(registrationCalls.length).toBeGreaterThanOrEqual(1);

    const backend = (process.env.VIDA_STORAGE_BACKEND ?? "file").toLowerCase();
    let lastEntry: Record<string, string> | undefined;

    if (backend === "prisma") {
      const storage = getStorage();
      if (typeof storage.dlq.count === "function") {
        const count = await storage.dlq.count();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    } else {
      const dlqContent = await readFile(dlqPath, "utf8");
      const lines = dlqContent.trim().split("\n");
      expect(lines).not.toHaveLength(0);
      lastEntry = JSON.parse(lines.at(-1) ?? "{}") as Record<string, string>;
      expect(lastEntry.invoiceId).toBe("INV-ERR");
    }
    if (lastEntry) {
      expect(lastEntry.error).toMatch(/Billit send failed/);
    }

    await rm(tmpRoot, { force: true, recursive: true });
  }, 15000);
});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
