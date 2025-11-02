import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    postMock.mockResolvedValueOnce({
      data: {
        participants: [
          {
            identifiers: {
              vatNumber: "0755799452"
            }
          }
        ]
      }
    });
    postMock.mockResolvedValueOnce({ data: { documentId: "doc-abc" } });
    const { sendSalesInvoiceJson } = await import("../../src/adapters/scrada.ts");
    const invoice = buildMinimalInvoice();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-adapter-"));

    try {
      const result = await sendSalesInvoiceJson(invoice, {
        externalReference: "EXT-123",
        artifactDir: tempDir
      });

      expect(postMock).toHaveBeenCalledTimes(2);
      const [lookupPath, lookupBody] = postMock.mock.calls[0];
      expect(lookupPath).toBe("/peppol/partyLookup");
      expect(lookupBody).toMatchObject({
        countryCode: "BE",
        identifiers: [
          {
            scheme: "0208",
            value: "0755799452"
          }
        ]
      });

      const [requestPath, payload, config] = postMock.mock.calls[1];
      expect(requestPath).toBe("/company/company-001/peppol/outbound/salesInvoice");
      expect(payload.externalReference).toBe("EXT-123");
      expect(config?.headers?.["Content-Type"]).toBe("application/json");

      expect(result.documentId).toBe("doc-abc");
      expect(result.deliveryPath).toBe("json");
      expect(result.fallback.triggered).toBe(false);
      expect(result.artifacts.error).toBeNull();
      expect(result.artifacts.ubl).toBeNull();

      const jsonFilePath = path.resolve(process.cwd(), result.artifacts.json);
      const storedPayload = JSON.parse(await readFile(jsonFilePath, "utf8"));
      expect(storedPayload.externalReference).toBe("EXT-123");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to UBL when Scrada rejects the JSON payload", async () => {
    const axiosError = new Error("Bad request");
    Object.assign(axiosError, {
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: "Invalid buyer VAT" }
      }
    });

    postMock.mockResolvedValueOnce({
      data: {
        participants: [
          {
            identifiers: {
              vatNumber: "0755799452"
            }
          }
        ]
      }
    });
    postMock.mockRejectedValueOnce(axiosError);
    postMock.mockResolvedValueOnce({ data: { documentId: "doc-ubl" } });

    const { sendSalesInvoiceJson } = await import("../../src/adapters/scrada.ts");
    const invoice = buildMinimalInvoice();
    invoice.externalReference = "EXT-400";
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-adapter-"));

    try {
      const result = await sendSalesInvoiceJson(invoice, {
        externalReference: "EXT-400",
        artifactDir: tempDir
      });

      expect(postMock).toHaveBeenCalledTimes(3);

      const [lookupPath, lookupBody] = postMock.mock.calls[0];
      expect(lookupPath).toBe("/peppol/partyLookup");
      expect(lookupBody).toMatchObject({
        identifiers: [
          {
            scheme: "0208",
            value: "0755799452"
          }
        ]
      });

      const [jsonPath, jsonPayload, jsonConfig] = postMock.mock.calls[1];
      expect(jsonPath).toBe("/company/company-001/peppol/outbound/salesInvoice");
      expect(jsonConfig?.headers?.["Content-Type"]).toBe("application/json");
      expect(jsonPayload.externalReference).toBe("EXT-400");

      const [ublPath, ublPayload, ublConfig] = postMock.mock.calls[2];
      expect(ublPath).toBe("/company/company-001/peppol/outbound/document");
      expect(ublConfig?.headers?.["Content-Type"]).toBe("application/xml");
      expect(typeof ublPayload).toBe("string");

      expect(result.documentId).toBe("doc-ubl");
      expect(result.deliveryPath).toBe("ubl");
      expect(result.fallback.triggered).toBe(true);
      expect(result.fallback.status).toBe(400);
      expect(result.artifacts.error).toBeTruthy();
      expect(result.artifacts.ubl).toBeTruthy();

      const errorFilePath = path.resolve(process.cwd(), result.artifacts.error);
      const errorContents = await readFile(errorFilePath, "utf8");
      expect(errorContents).toContain("Invalid buyer VAT");

      const ublFilePath = path.resolve(process.cwd(), result.artifacts.ubl);
      const ublContents = await readFile(ublFilePath, "utf8");
      expect(ublContents).toContain("<Invoice");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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
        params: { peppolID: "0088:123456789" },
        paramsSerializer: expect.objectContaining({
          serialize: expect.any(Function)
        })
      })
    );
  });

  it("performs party lookup without company scope", async () => {
    postMock.mockResolvedValueOnce({ data: { exists: true } });
    const { lookupPartyBySchemeValue } = await import("../../src/adapters/scrada.ts");

    await expect(lookupPartyBySchemeValue("0208", "0755799452")).resolves.toMatchObject({
      peppolId: "0208:0755799452",
      exists: true
    });
    expect(postMock).toHaveBeenCalledWith("/peppol/partyLookup", {
      countryCode: "BE",
      identifiers: [
        {
          scheme: "0208",
          value: "0755799452"
        }
      ]
    });
  });
});
