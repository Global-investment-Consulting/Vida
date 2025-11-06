import { describe, expect, it, beforeEach } from "vitest";
import { buildScradaJsonInvoice, buildScradaUblInvoice } from "../src/scrada/payload.ts";

const SUPPLIER_SCHEME = "0208";
const SUPPLIER_ID = "0123456789";
const SUPPLIER_VAT = "BE0123456789";

describe("scrada payload builders (BIS 3.0)", () => {
  beforeEach(() => {
    process.env.SCRADA_SUPPLIER_SCHEME = SUPPLIER_SCHEME;
    process.env.SCRADA_SUPPLIER_ID = SUPPLIER_ID;
    process.env.SCRADA_SUPPLIER_VAT = SUPPLIER_VAT;
  });

  it("builds a JSON invoice with fixed BIS 3.0 receiver defaults", () => {
    const invoice = buildScradaJsonInvoice({ invoiceId: "INV-JSON" });

    expect(invoice.number).toBe("INV-JSON");
    expect(invoice.customer.peppolID).toBe("0208:0755799452");
    expect(invoice.customer.vatNumber).toBe("BE0755799452");
    expect(invoice.supplier.vatNumber).toBe(SUPPLIER_VAT);
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.totalInclVat).toBeCloseTo(121);
  });

  it("builds a UBL invoice with the final BIS 3.0 identifiers", () => {
    const ubl = buildScradaUblInvoice({ invoiceId: "INV-UBL" });

    expect(ubl).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>");
    expect(ubl).toContain("<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:ProfileID>");
    expect(ubl).toContain('<cbc:EndpointID schemeID="0208">0755799452</cbc:EndpointID>');
    expect(ubl).toContain('<cbc:CompanyID schemeID="0208">0755799452</cbc:CompanyID>');
    expect(ubl).not.toMatch(/AccountingCustomerParty[\s\S]*PartyTaxScheme/);
    expect(ubl).toContain("<cac:PaymentTerms>");
  });
});
