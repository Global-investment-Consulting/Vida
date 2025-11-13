import { createHmac } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { submitInvoiceMock } = vi.hoisted(() => ({
  submitInvoiceMock: vi.fn()
}));

vi.mock("../../src/routes/invoicesV0.ts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    submitInvoiceFromDto: submitInvoiceMock
  };
});
vi.mock("../../dist/src/routes/invoicesV0.js", async () => {
  const actual = await import("../../dist/src/routes/invoicesV0.js");
  return {
    ...actual,
    submitInvoiceFromDto: submitInvoiceMock
  };
});

let app: Express;

beforeAll(async () => {
  const mod = await import("src/server.js");
  app = mod.app;
});

afterAll(() => {
  vi.resetModules();
});

const SHOPIFY_SECRET = "shop-secret";

function buildShopifyOrder() {
  return {
    id: 123456,
    name: "#1001",
    order_number: 1001,
    created_at: "2025-02-01T10:00:00.000Z",
    currency: "EUR",
    line_items: [
      {
        title: "Consulting",
        quantity: 1,
        price: "5000.00",
        tax_lines: [{ rate: 0.21 }]
      }
    ],
    customer: {
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com"
    },
    shipping_address: {
      name: "Jane Doe",
      address1: "Main street 1",
      city: "Brussels",
      zip: "1000",
      country_code: "BE"
    }
  };
}

describe("Shopify webhook", () => {
  beforeEach(() => {
    process.env.SHOPIFY_WEBHOOK_SECRET = SHOPIFY_SECRET;
    process.env.SCRADA_SUPPLIER_NAME = "Vida Supplier BV";
    process.env.SCRADA_SUPPLIER_ID = "0755799452";
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_VAT = "BE0755799452";
    process.env.SCRADA_API_KEY = "test-key";
    process.env.SCRADA_API_PASSWORD = "test-password";
    process.env.SCRADA_COMPANY_ID = "VIDA-COMPANY";
    submitInvoiceMock.mockResolvedValue({
      invoiceId: "01SHOPIFYTEST",
      externalReference: "#1001",
      documentId: "doc-123",
      normalizedStatus: "PENDING"
    });
  });

  afterEach(() => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    delete process.env.SCRADA_SUPPLIER_NAME;
    delete process.env.SCRADA_SUPPLIER_ID;
    delete process.env.SCRADA_SUPPLIER_SCHEME;
    delete process.env.SCRADA_SUPPLIER_VAT;
    delete process.env.SCRADA_API_KEY;
    delete process.env.SCRADA_API_PASSWORD;
    delete process.env.SCRADA_COMPANY_ID;
    submitInvoiceMock.mockReset();
  });

  it("verifies signature and forwards to invoice handler", async () => {
    const body = Buffer.from(JSON.stringify(buildShopifyOrder()));
    const signature = createHmac("sha256", SHOPIFY_SECRET).update(body).digest("base64");

    const response = await request(app)
      .post("/v0/webhooks/shopify")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", signature)
      .send(body)
      .expect(202);

    expect(response.body.invoiceId).toBe("01SHOPIFYTEST");
    expect(submitInvoiceMock).toHaveBeenCalledOnce();
    expect(submitInvoiceMock.mock.calls[0][0]).toMatchObject({
      currency: "EUR",
      seller: expect.objectContaining({
        endpoint: expect.objectContaining({ id: "0755799452", scheme: "0208" })
      })
    });
  });
});
