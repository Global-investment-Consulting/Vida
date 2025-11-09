import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = join(process.cwd(), "peppol/fixtures/invoice_peppol_bis3.xml");

describe("UBL fixture tax classification", () => {
  it("marks each invoice line with S/21 VAT classification", () => {
    const xml = readFileSync(fixturePath, "utf8");
    const lineMatches = Array.from(
      xml.matchAll(/<cac:InvoiceLine>[\s\S]*?<cac:Item>([\s\S]*?)<\/cac:Item>/g)
    );
    expect(lineMatches.length).toBeGreaterThan(0);
    for (const match of lineMatches) {
      const itemBlock = match[1];
      expect(itemBlock).toMatch(/<cac:ClassifiedTaxCategory>[\s\S]*?<cbc:ID>S<\/cbc:ID>/);
      expect(itemBlock).toMatch(/<cbc:Percent>21<\/cbc:Percent>/);
      expect(itemBlock).toMatch(/<cac:TaxScheme>[\s\S]*?<cbc:ID>VAT<\/cbc:ID>/);
    }
  });
});
