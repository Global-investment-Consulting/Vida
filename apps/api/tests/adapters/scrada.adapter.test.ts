import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
const getMock = vi.fn();

vi.mock("../../src/lib/http.ts", () => ({
  getScradaClient: () => ({
    post: postMock,
    get: getMock
  }),
  getScradaConfig: () => ({
    baseUrl: "https://apitest.scrada.be/v1/",
    apiKey: "test-api-key",
    password: "test-password",
    language: "EN"
  })
}));

function buildMinimalInvoice() {
  return {
    id: "INV-123",
    issueDate: "2025-01-01",
    currency: "EUR",
    buyer: {
      name: "Buyer NV",
      address: {
        streetName: "Main",
        postalZone: "1000",
        cityName: "Brussels",
        countryCode: "BE"
      }
    },
    seller: {
      name: "Seller NV",
      address: {
        streetName: "Other",
        postalZone: "2000",
        cityName: "Antwerp",
        countryCode: "BE"
      }
    },
    totals: {
      lineExtensionAmount: { currency: "EUR", value: 100 },
      taxExclusiveAmount: { currency: "EUR", value: 100 },
      taxInclusiveAmount: { currency: "EUR", value: 121 },
      payableAmount: { currency: "EUR", value: 121 },
      taxTotals: [
        {
          rate: 21,
          taxableAmount: { currency: "EUR", value: 100 },
          taxAmount: { currency: "EUR", value: 21 }
        }
      ]
    },
    lines: [
      {
        id: "1",
        description: "Service",
        quantity: 1,
        unitPrice: { currency: "EUR", value: 100 },
        lineExtensionAmount: { currency: "EUR", value: 100 },
        vat: {
          rate: 21,
          taxableAmount: { currency: "EUR", value: 100 },
          taxAmount: { currency: "EUR", value: 21 }
        }
      }
    ]
  };
}

describe("scrada adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    postMock.mockReset();
    getMock.mockReset();
    process.env.SCRADA_COMPANY_ID = "company-001";
  });

  afterEach(() => {
    delete process.env.SCRADA_COMPANY_ID;
  });

  it("sends sales invoice JSON to the expected endpoint", async () => {
    postMock.mockResolvedValue({ data: { documentId: "doc-abc" } });
    const { sendSalesInvoiceJson } = await import("../../src/adapters/scrada.ts");
    const invoice = buildMinimalInvoice();

    const result = await sendSalesInvoiceJson(invoice, { externalReference: "EXT-123" });

    expect(postMock).toHaveBeenCalledTimes(1);
    const [path, payload, config] = postMock.mock.calls[0];
    expect(path).toBe("/company/company-001/peppol/outbound/salesInvoice");
    expect(payload.externalReference).toBe("EXT-123");
    expect(config?.headers?.["Content-Type"]).toBe("application/json");
    expect(result).toEqual({ documentId: "doc-abc" });
  });

  it("fetches UBL content with trimmed document id", async () => {
    getMock.mockResolvedValue({ data: "<xml>payload</xml>" });
    const { getOutboundUbl } = await import("../../src/adapters/scrada.ts");

    const xml = await getOutboundUbl(" doc-123 ");

    expect(getMock).toHaveBeenCalledWith(
      "/company/company-001/peppol/outbound/document/doc-123/ubl",
      expect.objectContaining({
        responseType: "text",
        headers: expect.objectContaining({ Accept: "application/xml" })
      })
    );
    expect(xml).toBe("<xml>payload</xml>");
  });

  it("interprets participant lookup responses", async () => {
    getMock.mockResolvedValueOnce({ data: { exists: true, participants: [{ name: "ACME" }] } });
    const { lookupParticipantById } = await import("../../src/adapters/scrada.ts");

    await expect(lookupParticipantById("0088:123456789")).resolves.toMatchObject({
      peppolId: "0088:123456789",
      exists: true,
      response: {
        exists: true,
        participants: [{ name: "ACME" }]
      }
    });
    expect(getMock).toHaveBeenCalledWith(
      "/peppol/participantLookup",
      expect.objectContaining({
        params: { peppolID: "0088:123456789" }
      })
    );
  });
});
