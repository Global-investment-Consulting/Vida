import { describe, expect, it } from "vitest";
import {
  buildScradaJsonInvoice,
  buildScradaUblInvoice,
  resolveBuyerVatVariants,
  OMIT_BUYER_VAT_VARIANT
} from "../src/scrada/payload.ts";

describe("scrada payload builders", () => {
  it("generates buyer VAT variants in the expected order", () => {
    const variants = resolveBuyerVatVariants("BE0755799452");
    expect(variants).toEqual(["BE0755799452", "0755799452", "BE 0755 799 452"]);
  });

  it("builds a consistent JSON invoice shape", () => {
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_ID = "0123456789";
    process.env.SCRADA_SUPPLIER_VAT = "BE0123456789";
    process.env.SCRADA_TEST_RECEIVER_SCHEME = "0208";
    process.env.SCRADA_TEST_RECEIVER_ID = "0755799452";
    process.env.SCRADA_RECEIVER_VAT = "BE0755799452";

    const invoice = buildScradaJsonInvoice({ invoiceId: "INV-TEST", buyerVat: "BE0755799452" });

    expect(invoice.number).toBe("INV-TEST");
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.totalInclVat).toBeCloseTo(121);
    expect(invoice.supplier.vatNumber).toBe("BE0123456789");
    expect(invoice.customer.vatNumber).toBe("BE0755799452");
    expect(invoice.customer.peppolID).toBe("0208:0755799452");
  });

  it("omits buyer VAT details when the omit variant is used", () => {
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_ID = "0123456789";
    process.env.SCRADA_SUPPLIER_VAT = "BE0123456789";
    process.env.SCRADA_TEST_RECEIVER_SCHEME = "0208";
    process.env.SCRADA_TEST_RECEIVER_ID = "0755799452";
    process.env.SCRADA_RECEIVER_VAT = "BE0755799452";

    const invoice = buildScradaJsonInvoice({
      invoiceId: "INV-OMIT",
      buyerVat: OMIT_BUYER_VAT_VARIANT
    });

    expect(invoice.customer.vatNumber).toBeUndefined();

    const ubl = buildScradaUblInvoice({
      invoiceId: "INV-OMIT-UBL",
      buyerVat: OMIT_BUYER_VAT_VARIANT
    });

    const supplierSection = ubl.slice(
      ubl.indexOf("<cac:AccountingSupplierParty>"),
      ubl.indexOf("</cac:AccountingSupplierParty>")
    );
    const customerSection = ubl.slice(
      ubl.indexOf("<cac:AccountingCustomerParty>"),
      ubl.indexOf("</cac:AccountingCustomerParty>")
    );

    expect(supplierSection).toContain("<cac:PartyTaxScheme>");
    expect(customerSection).not.toContain("<cac:PartyTaxScheme>");
  });

  it("renders BIS 3.0 UBL with mandatory identifiers", () => {
    process.env.SCRADA_SUPPLIER_SCHEME = "0208";
    process.env.SCRADA_SUPPLIER_ID = "0123456789";
    process.env.SCRADA_SUPPLIER_VAT = "BE0123456789";
    process.env.SCRADA_TEST_RECEIVER_SCHEME = "0208";
    process.env.SCRADA_TEST_RECEIVER_ID = "0755799452";
    process.env.SCRADA_RECEIVER_VAT = "BE0755799452";

    const ubl = buildScradaUblInvoice({
      invoiceId: "INV-UBL",
      buyerVat: "0755799452"
    });

    expect(ubl).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>");
    expect(ubl).toContain("<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:ProfileID>");
    expect(ubl).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(ubl).toContain(
      '<cbc:EndpointID schemeID="0208">0755799452</cbc:EndpointID>'
    );
    expect(ubl).toContain("<cbc:BuyerReference>INV-UBL</cbc:BuyerReference>");
    const normalizedUbl = ubl.replace(/\s+/g, " ");
    expect(normalizedUbl).toContain('<cbc:CompanyID schemeID="VAT">BE0755799452</cbc:CompanyID>');
    expect(ubl).toContain("<cac:PaymentTerms>");
  });
});
