import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUPPLIER_SCHEME = "0208";
const SUPPLIER_ID = "0123456789";
const SUPPLIER_VAT = "BE0123456789";

describe("scrada payload totals", () => {
  const originalProfile = process.env.SCRADA_RECEIVER_PROFILE;

  beforeEach(() => {
    vi.resetModules();
    process.env.SCRADA_SUPPLIER_SCHEME = SUPPLIER_SCHEME;
    process.env.SCRADA_SUPPLIER_ID = SUPPLIER_ID;
    process.env.SCRADA_SUPPLIER_VAT = SUPPLIER_VAT;
  });

  afterEach(() => {
    if (originalProfile === undefined) {
      delete process.env.SCRADA_RECEIVER_PROFILE;
    } else {
      process.env.SCRADA_RECEIVER_PROFILE = originalProfile;
    }
  });

  it("omits TotalInclVat when using exclusive VAT mode", async () => {
    process.env.SCRADA_RECEIVER_PROFILE = "0208";
    const { buildScradaJsonInvoice } = await import("../src/scrada/payload.ts");
    const invoice = buildScradaJsonInvoice({ invoiceId: "INV-EXCL" });

    expect(invoice.isInclVat).toBe(false);
    expect(invoice.totalExclVat).toBeCloseTo(100);
    expect(invoice.totalInclVat).toBeUndefined();
    expect(invoice.lines[0].totalExclVat).toBeCloseTo(100);
    expect(invoice.lines[0].totalInclVat).toBeUndefined();
    expect(invoice.vatTotals[0].totalExclVat).toBeCloseTo(100);
    expect(invoice.vatTotals[0].totalInclVat).toBeUndefined();
  });

  it("omits TotalExclVat when using inclusive VAT mode", async () => {
    process.env.SCRADA_RECEIVER_PROFILE = "9925";
    vi.resetModules();
    const { buildScradaJsonInvoice } = await import("../src/scrada/payload.ts");
    const invoice = buildScradaJsonInvoice({ invoiceId: "INV-INCL" });

    expect(invoice.isInclVat).toBe(true);
    expect(invoice.totalInclVat).toBeCloseTo(121);
    expect(invoice.totalExclVat).toBeUndefined();
    expect(invoice.lines[0].totalInclVat).toBeCloseTo(121);
    expect(invoice.lines[0].totalExclVat).toBeUndefined();
    expect(invoice.vatTotals[0].totalInclVat).toBeCloseTo(121);
    expect(invoice.vatTotals[0].totalExclVat).toBeUndefined();
  });
});
