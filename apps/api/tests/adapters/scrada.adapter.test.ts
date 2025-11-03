import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();

vi.mock("../../src/lib/http.ts", () => ({
  getScradaClient: () => ({
    post: postMock
  })
}));

function createAxiosVatError(message: string) {
  const error = new Error(message);
  Object.assign(error, {
    isAxiosError: true,
    response: {
      status: 400,
      data: message
    }
  });
  return error;
}

describe("sendInvoiceWithFallback", () => {
  beforeEach(() => {
    postMock.mockReset();
    process.env.SCRADA_COMPANY_ID = "0208:COMPANY";
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_ID = "0123456789";
    process.env.SCRADA_SUPPLIER_VAT = "BE0123456789";
    process.env.SCRADA_TEST_RECEIVER_SCHEME = "0208";
    process.env.SCRADA_TEST_RECEIVER_ID = "0755799452";
    process.env.SCRADA_RECEIVER_VAT = "BE0755799452";
  });

  afterEach(() => {
    delete process.env.SCRADA_COMPANY_ID;
    delete process.env.SCRADA_SUPPLIER_SCHEME;
    delete process.env.SCRADA_SUPPLIER_ID;
    delete process.env.SCRADA_SUPPLIER_VAT;
    delete process.env.SCRADA_TEST_RECEIVER_SCHEME;
    delete process.env.SCRADA_TEST_RECEIVER_ID;
    delete process.env.SCRADA_RECEIVER_VAT;
  });

  it("succeeds on the initial JSON attempt", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-send-"));
    postMock.mockResolvedValue({ data: { documentId: "DOC-001" } });
    const { sendInvoiceWithFallback } = await import("../../src/adapters/scrada.ts");

    const result = await sendInvoiceWithFallback({ artifactDir: tempDir });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(result.channel).toBe("json");
    expect(result.documentId).toBe("DOC-001");

    const jsonPayload = await readFile(path.join(tempDir, "json-sent.json"), "utf8");
    expect(jsonPayload).toContain("\"vatNumber\": \"BE0755799452\"");
  });

  it("retries variants and falls back to UBL on VAT validation errors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-send-"));
    const responses = [
      () => {
        throw createAxiosVatError("Buyer VAT invalid");
      },
      () => {
        throw createAxiosVatError("VAT mismatch");
      },
      () => ({ data: { documentId: "DOC-UBL" } })
    ];

    postMock.mockImplementation((pathName) => {
      const handler = responses.shift();
      if (!handler) {
        throw new Error(`Unexpected extra call for ${pathName}`);
      }
      return handler();
    });

    const { sendInvoiceWithFallback } = await import("../../src/adapters/scrada.ts");

    const result = await sendInvoiceWithFallback({ artifactDir: tempDir });

    expect(result.channel).toBe("ubl");
    expect(result.documentId).toBe("DOC-UBL");
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0].channel).toBe("json");
    expect(result.attempts[1].channel).toBe("json");
    expect(result.attempts[2].channel).toBe("ubl");

    const jsonPayload = await readFile(path.join(tempDir, "json-sent.json"), "utf8");
    expect(jsonPayload).toContain("\"vatNumber\": \"BE 0755 799 452\"");

    const errorContents = await readFile(path.join(tempDir, "error-body.txt"), "utf8");
    expect(errorContents).toMatch(/VAT/i);

    const ublPayload = await readFile(path.join(tempDir, "ubl-sent.xml"), "utf8");
    expect(ublPayload).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>");
  });

  it("fails immediately on non-VAT validation errors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-send-"));
    const nonVatError = new Error("Bad request");
    Object.assign(nonVatError, {
      isAxiosError: true,
      response: {
        status: 422,
        data: "Bad request"
      }
    });
    postMock.mockRejectedValue(nonVatError);

    const { sendInvoiceWithFallback } = await import("../../src/adapters/scrada.ts");

    await expect(sendInvoiceWithFallback({ artifactDir: tempDir })).rejects.toThrow(
      /Bad request/
    );
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
