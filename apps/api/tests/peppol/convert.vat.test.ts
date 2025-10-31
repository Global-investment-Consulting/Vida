import { create } from "xmlbuilder2";
import { describe, expect, it } from "vitest";
import { orderToInvoiceXml } from "src/peppol/convert.js";

type XmlNode = string | Record<string, unknown>;

function xmlToObject(xml: string): Record<string, unknown> {
  return create(xml).end({ format: "object" }) as Record<string, unknown>;
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

describe("orderToInvoiceXml VAT handling", () => {
  it("generates deterministic VAT subtotals for mixed Belgian rates", async () => {
    const xml = await orderToInvoiceXml({
      orderNumber: "INV-1000",
      currency: "EUR",
      issueDate: new Date("2025-01-10"),
      buyer: { name: "Buyer BV" },
      supplier: { name: "Supplier NV" },
      defaultVatRate: 21,
      lines: [
        { description: "Consulting", quantity: 1, unitPriceMinor: 10000, vatRate: 21 },
        { description: "Reduced", quantity: 1, unitPriceMinor: 5000, vatRate: 6 },
        { description: "Intermediate", quantity: 1, unitPriceMinor: 7000, vatRate: 12 }
      ]
    });

    const invoice = xmlToObject(xml).Invoice as Record<string, unknown>;
    const taxTotal = invoice["cac:TaxTotal"] as Record<string, unknown>;
    const subtotalRaw = taxTotal["cac:TaxSubtotal"] as XmlNode | XmlNode[];
    const subtotals = toArray(subtotalRaw).map((entry) => entry as Record<string, unknown>);

    const percents = subtotals.map((entry) => {
      const category = entry["cac:TaxCategory"] as Record<string, unknown>;
      return text(category["cbc:Percent"]);
    });
    expect(percents).toEqual(["6.00", "12.00", "21.00"]);

    const categories = subtotals.map((entry) => {
      const category = entry["cac:TaxCategory"] as Record<string, unknown>;
      return text(category["cbc:ID"]);
    });
    expect(categories).toEqual(["S", "S", "S"]);
  });

  it("emits reverse charge lines with AE categories", async () => {
    const xml = await orderToInvoiceXml({
      orderNumber: "INV-2000",
      currency: "EUR",
      issueDate: new Date("2025-02-05"),
      buyer: { name: "Reverse Buyer" },
      supplier: { name: "Supplier NV" },
      lines: [
        {
          description: "Intra-community",
          quantity: 1,
          unitPriceMinor: 12000,
          vatRate: 0,
          vatExemptionReason: "Reverse charge - article 194"
        }
      ]
    });

    const invoice = xmlToObject(xml).Invoice as Record<string, unknown>;
    const taxTotal = invoice["cac:TaxTotal"] as Record<string, unknown>;
    const subtotal = taxTotal["cac:TaxSubtotal"] as Record<string, unknown>;
    const category = subtotal["cac:TaxCategory"] as Record<string, unknown>;

    expect(text(category["cbc:ID"])).toBe("AE");
    expect(text(category["cbc:TaxExemptionReason"])).toContain("Reverse charge");
  });

  it("handles discounts, shipping lines, and rounding consistently", async () => {
    const xml = await orderToInvoiceXml({
      orderNumber: "INV-3000",
      currency: "EUR",
      issueDate: new Date("2025-03-01"),
      buyer: { name: "Buyer BV" },
      supplier: { name: "Supplier NV" },
      lines: [
        {
          description: "Consulting hours",
          quantity: 2,
          unitPriceMinor: 1000,
          discountMinor: 200,
          vatRate: 21
        },
        {
          description: "Shipping",
          quantity: 1,
          unitPriceMinor: 500,
          vatRate: 21,
          itemName: "Shipping"
        }
      ]
    });

    const invoice = xmlToObject(xml).Invoice as Record<string, unknown>;
    const linesRaw = invoice["cac:InvoiceLine"] as XmlNode | XmlNode[];
    const lines = toArray(linesRaw).map((entry) => entry as Record<string, unknown>);

    expect(lines).toHaveLength(2);

    const firstLine = lines[0];
    expect(text(firstLine["cbc:LineExtensionAmount"])).toBe("18.00");
    const secondLine = lines[1];
    expect(text(secondLine["cbc:LineExtensionAmount"])).toBe("5.00");

    const taxTotal = invoice["cac:TaxTotal"] as Record<string, unknown>;
    expect(text(taxTotal["cbc:TaxAmount"])).toBe("4.83");

    const monetary = invoice["cac:LegalMonetaryTotal"] as Record<string, unknown>;
    expect(text(monetary["cbc:PayableAmount"])).toBe("27.83");
  });
});
