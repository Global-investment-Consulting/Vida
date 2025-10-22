import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MockAgent,
  type MockClient,
  fetch as undiciFetch,
  getGlobalDispatcher,
  setGlobalDispatcher
} from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billitAdapter, resetBillitAuthCache } from "src/apadapters/billit.js";
import { getAdapter } from "src/apadapters/index.js";
import { sendWithRetry } from "src/services/apDelivery.js";
import { resetInvoiceStatusCache } from "src/history/invoiceStatus.js";

const BASE_URL = "https://billit.test";
const originalFetch = globalThis.fetch;

describe("billit adapter", () => {
  let agent: MockAgent;
  let client: MockClient;
  const originalDispatcher = getGlobalDispatcher();

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
    client = agent.get(BASE_URL);
    setGlobalDispatcher(agent);
    globalThis.fetch = undiciFetch;
    process.env.AP_BASE_URL = BASE_URL;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    resetBillitAuthCache();
    delete process.env.AP_BASE_URL;
    delete process.env.AP_API_KEY;
    delete process.env.AP_CLIENT_ID;
    delete process.env.AP_CLIENT_SECRET;
    delete process.env.VIDA_DLQ_PATH;
    delete process.env.VIDA_INVOICE_STATUS_DIR;
    resetInvoiceStatusCache();
    await agent.close();
    setGlobalDispatcher(originalDispatcher);
    vi.useRealTimers();
  });

  it("registers via getAdapter", () => {
    const adapter = getAdapter("billit");
    expect(adapter.name).toBe("billit");
  });

  it("sends invoice with API key authentication", async () => {
    const apiKey = "test-api-key";
    process.env.AP_API_KEY = apiKey;

    client
      .intercept({
        path: "/api/invoices",
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/xml",
          accept: "application/json"
        },
        body: "<Invoice />"
      })
      .reply(
        201,
        {
          providerId: "billit-123",
          status: "queued"
        },
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );

    const result = await billitAdapter.send({
      tenant: "acme",
      invoiceId: "INV-001",
      ublXml: "<Invoice />"
    });

    expect(result).toEqual({
      providerId: "billit-123",
      status: "queued",
      message: undefined
    });
  });

  it("sends invoice with OAuth client credentials when API key missing", async () => {
    process.env.AP_CLIENT_ID = "client-id";
    process.env.AP_CLIENT_SECRET = "client-secret";

    client
      .intercept({
        path: "/oauth/token",
        method: "POST",
        body: "grant_type=client_credentials&client_id=client-id&client_secret=client-secret"
      })
      .reply(
        200,
        {
          access_token: "oauth-token",
          token_type: "Bearer",
          expires_in: 3600
        },
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );

    client
      .intercept({
        path: "/api/invoices",
        method: "POST",
        headers: {
          authorization: "Bearer oauth-token",
          "content-type": "application/xml",
          accept: "application/json"
        }
      })
      .reply(
        202,
        {
          id: "billit-456",
          status: "submitted"
        },
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );

    const result = await billitAdapter.send({
      tenant: "acme",
      invoiceId: "INV-002",
      ublXml: "<Invoice />"
    });

    expect(result).toEqual({
      providerId: "billit-456",
      status: "sent",
      message: undefined
    });
  });

  it("maps provider status to delivered on status fetch", async () => {
    const apiKey = "test-status-key";
    process.env.AP_API_KEY = apiKey;

    client
      .intercept({
        path: "/api/invoices/billit-789/status",
        method: "GET",
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json"
        }
      })
      .reply(
        200,
        {
          status: "COMPLETED",
          providerId: "billit-789"
        },
        {
          headers: {
            "content-type": "application/json"
          }
        }
      );

    const status = await billitAdapter.getStatus("billit-789");
    expect(status).toBe("delivered");
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

    for (let attempt = 0; attempt < 5; attempt += 1) {
      client
        .intercept({
          path: "/api/invoices",
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`
          }
        })
        .reply(
          502,
          {
            error: "bad_gateway"
          },
          {
            headers: {
              "content-type": "application/json"
            }
          }
        );
    }

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
        }
      })
    ).rejects.toThrow(/Billit send failed/);

    const dlqContent = await readFile(dlqPath, "utf8");
    const lines = dlqContent.trim().split("\n");
    expect(lines).not.toHaveLength(0);
    const lastEntry = JSON.parse(lines.at(-1) ?? "{}") as Record<string, string>;
    expect(lastEntry.invoiceId).toBe("INV-ERR");
    expect(lastEntry.error).toMatch(/Billit send failed/);

    await rm(tmpRoot, { force: true, recursive: true });
  }, 15000);
});
