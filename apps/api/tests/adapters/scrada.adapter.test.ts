import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn();
const ORIGINAL_PREFERRED_FORMAT = process.env.SCRADA_PREFERRED_FORMAT;

vi.mock("../../src/lib/http.ts", () => ({
  getScradaClient: () => ({
    post: postMock
  })
}));

vi.mock(
  "../../dist/src/lib/http.js",
  () => ({
    getScradaClient: () => ({
      post: postMock
    })
  }),
  { virtual: true }
);

function createAxiosError(status: number, message: string) {
  const error = new Error(message);
  Object.assign(error, {
    isAxiosError: true,
    response: {
      status,
      data: message,
      headers: {}
    }
  });
  return error;
}

describe("sendInvoiceWithFallback (BIS 3.0)", () => {
  beforeEach(() => {
    vi.resetModules();
    postMock.mockReset();
    process.env.SCRADA_COMPANY_ID = "0208:COMPANY";
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_ID = "0123456789";
    process.env.SCRADA_SUPPLIER_VAT = "BE0123456789";
    process.env.SCRADA_PREFERRED_FORMAT = "json";
  });

  afterEach(() => {
    if (ORIGINAL_PREFERRED_FORMAT === undefined) {
      delete process.env.SCRADA_PREFERRED_FORMAT;
    } else {
      process.env.SCRADA_PREFERRED_FORMAT = ORIGINAL_PREFERRED_FORMAT;
    }
    delete process.env.SCRADA_COMPANY_ID;
    delete process.env.SCRADA_SUPPLIER_SCHEME;
    delete process.env.SCRADA_SUPPLIER_ID;
    delete process.env.SCRADA_SUPPLIER_VAT;
  });

  it("succeeds on the initial JSON attempt", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-send-"));
    postMock.mockResolvedValue({ data: { documentId: "DOC-JSON" } });

    const { sendInvoiceWithFallback } = await import("../../src/adapters/scrada.ts");
    const result = await sendInvoiceWithFallback({ artifactDir: tempDir });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("salesInvoice"),
      expect.anything(),
      expect.objectContaining({ headers: { "Content-Type": "application/json" } })
    );
    expect(result.channel).toBe("json");
    expect(result.documentId).toBe("DOC-JSON");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ channel: "json", vatVariant: "BE0755799452", success: true });

    const jsonPayload = await readFile(path.join(tempDir, "json-sent.json"), "utf8");
    expect(jsonPayload).toContain("\"vatNumber\": \"BE0755799452\"");
  });

  it("falls back to UBL when the JSON attempt returns HTTP 400", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-send-"));
    postMock
      .mockRejectedValueOnce(createAxiosError(400, "Bad request"))
      .mockResolvedValueOnce({ data: { documentId: "DOC-UBL" } });

    const { sendInvoiceWithFallback } = await import("../../src/adapters/scrada.ts");
    const result = await sendInvoiceWithFallback({ artifactDir: tempDir });

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(result.channel).toBe("ubl");
    expect(result.documentId).toBe("DOC-UBL");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ channel: "json", success: false, vatVariant: "BE0755799452" });
    expect(result.attempts[1]).toMatchObject({ channel: "ubl", success: true, vatVariant: "BE0755799452" });

    const headersPreview = await readFile(path.join(tempDir, "headers-sent.txt"), "utf8");
    expect(headersPreview).toContain("x-scrada-peppol-sender-scheme: iso6523-actorid-upis");
    expect(headersPreview).toContain("x-scrada-peppol-receiver-scheme: iso6523-actorid-upis");
    expect(headersPreview).toContain("x-scrada-peppol-receiver-id: 0208:0755799452");
    expect(headersPreview).not.toContain("x-scrada-peppol-receiver-party-id");
  });

  it("surfaces non-400 errors without retrying UBL", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "scrada-send-"));
    postMock.mockRejectedValue(createAxiosError(422, "Unprocessable"));
    process.env.SCRADA_PREFERRED_FORMAT = "ubl";

    const { sendInvoiceWithFallback } = await import("../../src/adapters/scrada.ts");

    await expect(sendInvoiceWithFallback({ artifactDir: tempDir })).rejects.toThrow(/Unprocessable/);
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
