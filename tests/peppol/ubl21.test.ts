import { describe, expect, it } from "vitest";
import { create } from "xmlbuilder2";
import { buildInvoiceXml, invoiceToUbl } from "../../peppol/ubl21.js";
import { parseInvoice } from "src/schemas/invoice.js";
import validFixture from "./fixtures/valid-invoice.json" assert { type: "json" };
import mixedVatFixture from "./fixtures/mixed-vat.json" assert { type: "json" };
import zeroVatFixture from "./fixtures/zero-vat.json" assert { type: "json" };
import missingFixture from "./fixtures/missing-fields.json" assert { type: "json" };

type UblObject = Record<string, unknown>;

type XmlNode = string | Record<string, unknown>;

function xmlToObject(xml: string): UblObject {
  return create(xml).end({ format: "object" }) as UblObject;
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function text(node: XmlNode | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && "#" in node) {
    const value = (node as Record<string, unknown>)["#"];
    return value === undefined ? "" : String(value);
  }
  return "";
}

describe("peppol/ubl21", () => {
  it("generates a UBL 2.1 invoice for a valid payload", () => {
    const xml = buildInvoiceXml(validFixture, { pretty: false });
    expect(typeof xml).toBe("string");

    const invoice = xmlToObject(xml).Invoice as Record<string, unknown>;

    expect(invoice["cbc:CustomizationID"]).toBe("urn:cen.eu:en16931:2017");
    expect(invoice["cbc:ID"]).toBe("INV-1000");

    const taxTotal = invoice["cac:TaxTotal"] as Record<string, unknown>;
    expect(Number(text(taxTotal["cbc:TaxAmount"]))).toBeCloseTo(109.46, 2);

    const subtotalRaw = taxTotal["cac:TaxSubtotal"] as XmlNode | XmlNode[];
    const subtotals = toArray(subtotalRaw).map((entry) =>
      entry as Record<string, unknown>
    );
    const standardRate = subtotals.find((entry) => {
      const category = entry["cac:TaxCategory"] as Record<string, unknown>;
      return text(category["cbc:ID"]) === "S";
    });
    const reducedRate = subtotals.find((entry) => {
      const category = entry["cac:TaxCategory"] as Record<string, unknown>;
      return text(category["cbc:ID"]) === "AA";
    });
    expect(standardRate).toBeDefined();
    expect(reducedRate).toBeDefined();
    expect(Number(text((standardRate as Record<string, unknown>)["cbc:TaxAmount"]))).toBeCloseTo(104.11, 2);
    expect(Number(text((reducedRate as Record<string, unknown>)["cbc:TaxAmount"]))).toBeCloseTo(5.35, 2);

    const monetaryTotal = invoice["cac:LegalMonetaryTotal"] as Record<string, unknown>;
    expect(Number(text(monetaryTotal["cbc:LineExtensionAmount"]))).toBeCloseTo(590, 2);
    expect(Number(text(monetaryTotal["cbc:TaxExclusiveAmount"]))).toBeCloseTo(585, 2);
    expect(Number(text(monetaryTotal["cbc:PayableAmount"]))).toBeCloseTo(694.46, 2);
    expect(Number(text(monetaryTotal["cbc:AllowanceTotalAmount"]))).toBeCloseTo(5, 2);

    const invoiceLinesRaw = invoice["cac:InvoiceLine"] as XmlNode | XmlNode[];
    const invoiceLines = toArray(invoiceLinesRaw).map((line) =>
      line as Record<string, unknown>
    );
    expect(invoiceLines).toHaveLength(2);
    const discountedLine = invoiceLines.find((line) => text(line["cbc:ID"]) === "2");
    expect(discountedLine?.["cac:AllowanceCharge"]).toBeDefined();
  });

  it("aggregates mixed VAT rates into separate subtotals", () => {
    const xml = buildInvoiceXml(mixedVatFixture);
    const invoice = xmlToObject(xml).Invoice as Record<string, unknown>;
    const taxTotal = invoice["cac:TaxTotal"] as Record<string, unknown>;
    const subtotalRaw = taxTotal["cac:TaxSubtotal"] as XmlNode | XmlNode[];
    const taxSubtotals = toArray(subtotalRaw).map(
      (entry) => entry as Record<string, unknown>
    );

    expect(taxSubtotals).toHaveLength(3);
    const percents = taxSubtotals.map((entry) => {
      const category = entry["cac:TaxCategory"] as Record<string, unknown>;
      return text(category["cbc:Percent"] as XmlNode);
    });
    expect(percents).toEqual(expect.arrayContaining(["21.00", "6.00", "12.00"]));
  });

  it("emits zero VAT subtotals with exemption reasons", () => {
    const parsed = parseInvoice(zeroVatFixture);
    const xml = invoiceToUbl(parsed);
    const invoice = xmlToObject(xml).Invoice as Record<string, unknown>;
    const taxTotal = invoice["cac:TaxTotal"] as Record<string, unknown>;

    expect(Number(text(taxTotal["cbc:TaxAmount"]))).toBe(0);
    const taxSubtotal = taxTotal["cac:TaxSubtotal"] as Record<string, unknown>;
    const taxCategory = taxSubtotal["cac:TaxCategory"] as Record<string, unknown>;
    expect(text(taxCategory["cbc:TaxExemptionReason"])).toContain("reverse charge");
  });

  it("rejects invoices missing mandatory fields", () => {
    expect(() => buildInvoiceXml(missingFixture)).toThrow(/supplier/i);
  });
});
