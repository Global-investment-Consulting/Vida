import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = join(process.cwd(), "peppol/fixtures/invoice_peppol_bis3.xml");
const xml = readFileSync(fixturePath, "utf8");

describe("UBL fixture BR-CO-25 safeguards", () => {
  it("has a positive payable amount", () => {
    const match = xml.match(/<cbc:PayableAmount[^>]*>([^<]+)<\/cbc:PayableAmount>/);
    expect(match).toBeTruthy();
    const amount = Number(match?.[1] ?? 0);
    expect(amount).toBeGreaterThan(0);
  });

  it("provides DueDate or PaymentTerms when payable amount is positive", () => {
    const hasDueDate = /<cbc:DueDate>\s*\d{4}-\d{2}-\d{2}\s*<\/cbc:DueDate>/.test(xml);
    const hasPaymentTerms = /<cac:PaymentTerms>[\s\S]*?<cbc:Note>[\s\S]*?<\/cac:PaymentTerms>/.test(xml);
    expect(hasDueDate || hasPaymentTerms).toBe(true);
  });

  it("ensures every invoice line carries S/21 VAT classification", () => {
    const lineMatches = Array.from(
      xml.matchAll(/<cac:InvoiceLine>[\s\S]*?<cac:Item>([\s\S]*?)<\/cac:Item>/g)
    );
    expect(lineMatches.length).toBeGreaterThan(0);
    for (const [, block] of lineMatches) {
      expect(block).toMatch(/<cac:ClassifiedTaxCategory>[\s\S]*?<cbc:ID>S<\/cbc:ID>/);
      expect(block).toMatch(/<cbc:Percent>21<\/cbc:Percent>/);
      expect(block).toMatch(/<cac:TaxScheme>[\s\S]*?<cbc:ID>VAT<\/cbc:ID>/);
    }
  });
});
