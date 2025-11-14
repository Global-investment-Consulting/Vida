import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { Express } from "express";
import request, { type Test } from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadHistoryJson, saveHistoryJson, saveHistoryText } from "../../src/lib/history.js";
import { recordHistory } from "../../src/history/logger.js";
import { resetSubmissionsStoreCache, saveSubmission } from "../../src/services/submissionsStore.js";
import { resetStorage } from "../../src/storage/index.js";
import type { InvoiceDTO } from "../../src/types/public.js";

const { sendMock, statusMock } = vi.hoisted(() => {
  return {
    sendMock: vi.fn().mockResolvedValue({
      invoice: {},
      documentId: "doc-mock",
      invoiceId: "inv-mock",
      externalReference: "ext-mock",
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
    }),
    statusMock: vi.fn().mockResolvedValue({
      documentId: "doc-mock",
      status: "delivered"
    })
  };
});

vi.mock("../../src/services/scradaClient.js", () => ({
  sendInvoiceThroughScrada: sendMock,
  fetchScradaStatus: statusMock
}));
vi.mock("../../dist/src/services/scradaClient.js", () => ({
  sendInvoiceThroughScrada: sendMock,
  fetchScradaStatus: statusMock
}));

const ADMIN_KEY = "ops-admin-key";
const ORIGINAL_ENV = {
  OPS_DASHBOARD_ENABLED: process.env.OPS_DASHBOARD_ENABLED,
  DASHBOARD_ADMIN_USER: process.env.DASHBOARD_ADMIN_USER,
  DASHBOARD_ADMIN_PASS: process.env.DASHBOARD_ADMIN_PASS,
  ADMIN_DASHBOARD_KEY: process.env.ADMIN_DASHBOARD_KEY,
  NODE_ENV: process.env.NODE_ENV
};

process.env.OPS_DASHBOARD_ENABLED = "true";
process.env.DASHBOARD_ADMIN_USER = "ops";
process.env.DASHBOARD_ADMIN_PASS = "secret";
process.env.ADMIN_DASHBOARD_KEY = ADMIN_KEY;

describe("ops dashboard submissions", () => {
  let app: Express;
  let historyDir: string;
  let submissionsDir: string;

  beforeAll(async () => {
    const mod = await import("src/server.js");
    app = mod.app;
  });

  afterAll(() => {
    process.env.OPS_DASHBOARD_ENABLED = ORIGINAL_ENV.OPS_DASHBOARD_ENABLED;
    process.env.DASHBOARD_ADMIN_USER = ORIGINAL_ENV.DASHBOARD_ADMIN_USER;
    process.env.DASHBOARD_ADMIN_PASS = ORIGINAL_ENV.DASHBOARD_ADMIN_PASS;
    process.env.ADMIN_DASHBOARD_KEY = ORIGINAL_ENV.ADMIN_DASHBOARD_KEY;
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
    vi.resetModules();
  });

  beforeEach(async () => {
    historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-"));
    submissionsDir = await mkdtemp(path.join(tmpdir(), "vida-submissions-"));
    process.env.VIDA_HISTORY_DIR = historyDir;
    process.env.VIDA_PUBLIC_API_STORE_DIR = submissionsDir;
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV ?? "test";
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_ID = "0755799452";
    process.env.SCRADA_SUPPLIER_VAT = "BE0755799452";
    process.env.SCRADA_SUPPLIER_NAME = "Vida Supplier BV";
    process.env.SCRADA_RECEIVER_PROFILE = "0208";
    process.env.SCRADA_API_KEY = "test-key";
    process.env.SCRADA_API_PASSWORD = "test-password";
    process.env.SCRADA_COMPANY_ID = "VIDA-COMPANY";
    resetSubmissionsStoreCache();
    await resetStorage();
    sendMock.mockReset();
    sendMock.mockImplementation(async ({ invoiceId, externalReference }) => ({
      invoice: {},
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
    statusMock.mockReset();
    statusMock.mockImplementation(async (documentId: string) => ({
      documentId,
      status: "Delivered"
    }));
  });

  afterEach(async () => {
    delete process.env.VIDA_HISTORY_DIR;
    delete process.env.VIDA_PUBLIC_API_STORE_DIR;
    delete process.env.SCRADA_SUPPLIER_SCHEME;
    delete process.env.SCRADA_SUPPLIER_ID;
    delete process.env.SCRADA_SUPPLIER_VAT;
    delete process.env.SCRADA_SUPPLIER_NAME;
    delete process.env.SCRADA_RECEIVER_PROFILE;
    delete process.env.SCRADA_API_KEY;
    delete process.env.SCRADA_API_PASSWORD;
    delete process.env.SCRADA_COMPANY_ID;
    await rm(historyDir, { recursive: true, force: true });
    await rm(submissionsDir, { recursive: true, force: true });
    resetSubmissionsStoreCache();
    await resetStorage();
  });

  async function seedSubmission(overrides: Partial<{ invoiceId: string; documentId: string; externalReference: string; status: string }> = {}) {
    const invoiceId = overrides.invoiceId ?? `inv-${Math.random().toString(36).slice(2, 8)}`;
    const documentId = overrides.documentId ?? `doc-${Math.random().toString(36).slice(2, 6)}`;
    const record = await saveSubmission({
      scope: `tenant-a:${invoiceId}`,
      tenant: "tenant-a",
      idempotencyKey: `idem-${invoiceId}`,
      invoiceId,
      externalReference: overrides.externalReference ?? "PO-1000",
      documentId,
      status: overrides.status ?? "DELIVERED",
      buyerReference: "BR-42"
    });
    const dto: InvoiceDTO = {
      externalReference: record.externalReference,
      currency: "EUR",
      issueDate: "2024-01-01",
      seller: { name: "Vida Seller BV" },
      buyer: { name: "Acme GmbH" },
      lines: [
        {
          description: "Consulting",
          quantity: 1,
          unitPriceMinor: 1000
        }
      ]
    };
    await saveHistoryJson(invoiceId, "request", {
      invoiceId,
      receivedAt: new Date().toISOString(),
      payload: dto,
      source: "test",
      metadata: {}
    });
    await saveHistoryJson(invoiceId, "send", {
      invoiceId,
      externalReference: record.externalReference,
      provider: "scrada",
      documentId,
      sentAt: new Date().toISOString(),
      channel: "json",
      attempts: [
        {
          attempt: 1,
          channel: "json",
          success: true
        }
      ],
      vatVariant: "BE012",
      headerSweep: false
    });
    await saveHistoryJson(invoiceId, "status", {
      invoiceId,
      documentId,
      fetchedAt: new Date().toISOString(),
      status: "Delivered",
      normalizedStatus: "DELIVERED",
      info: { documentId, status: "Delivered" }
    });
    await saveHistoryText(invoiceId, "patched", "<Invoice />");
    await recordHistory({
      requestId: `req-${invoiceId}`,
      timestamp: new Date().toISOString(),
      source: "test",
      tenantId: "tenant-a",
      status: "ok",
      invoiceId,
      invoicePath: "",
      durationMs: 25
    });
    return record;
  }

  function auth(req: Test): Test {
    return req.set("X-Admin-Key", ADMIN_KEY);
  }

  it("lists submissions with filters applied", async () => {
    const first = await seedSubmission({ invoiceId: "inv-alpha", externalReference: "REF-ALPHA", status: "DELIVERED" });
    await seedSubmission({ invoiceId: "inv-beta", externalReference: "REF-BETA", status: "ERROR" });

    const res = await auth(
      request(app)
        .get("/ops/submissions")
        .query({ status: "delivered", q: "alpha" })
    ).expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].invoiceId).toBe(first.invoiceId);
    expect(res.body.items[0].artifacts.requestPath).toContain(first.invoiceId);
  });

  it("returns submission detail payloads", async () => {
    const record = await seedSubmission({ invoiceId: "inv-detail" });
    const res = await auth(request(app).get(`/ops/submissions/${record.invoiceId}`)).expect(200);

    expect(res.body.submission.invoiceId).toBe(record.invoiceId);
    expect(res.body.dto).toBeTruthy();
    expect(res.body.patchedUbl).toContain("<Invoice");
    expect(res.body.history.length).toBeGreaterThan(0);
    expect(res.body.attempts.length).toBe(1);
    expect(res.body.artifacts.requestPath).toContain(record.invoiceId);
  });

  it("rejects resend requests outside staging", async () => {
    const record = await seedSubmission({ invoiceId: "inv-no-resend" });
    process.env.NODE_ENV = "test";

    await auth(request(app).post(`/ops/submissions/${record.invoiceId}/resend`)).expect(403);
  });

  it("allows resend in staging and forwards provenance", async () => {
    const record = await seedSubmission({ invoiceId: "inv-staging" });
    process.env.NODE_ENV = "staging";

    const res = await auth(request(app).post(`/ops/submissions/${record.invoiceId}/resend`)).expect(202);

    expect(res.body.invoiceId).not.toBe(record.invoiceId);
    const requestArtifact = await loadHistoryJson<{ metadata?: Record<string, unknown> }>(
      res.body.invoiceId,
      "request"
    );
    expect(requestArtifact?.metadata).toMatchObject({ previousInvoiceId: record.invoiceId });
  });
});
