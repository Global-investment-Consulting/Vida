import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shopifyToOrder } from "src/connectors/shopify.js";

const fixturePath = path.resolve(__dirname, "fixtures", "shopify-order.json");

const supplier = {
  name: "Supplier BV",
  registrationName: "Supplier BV",
  vatId: "BE0123456789",
  address: {
    streetName: "Rue Exemple 1",
    cityName: "Brussels",
    postalZone: "1000",
    countryCode: "BE"
  },
  contact: {
    electronicMail: "invoices@supplier.example"
  }
};

describe("shopifyToOrder", () => {
  it("maps a Shopify order into the internal Order schema", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const shopifyOrder = JSON.parse(raw);

    const mapped = shopifyToOrder(shopifyOrder, { supplier, defaultVatRate: 21 });

    expect(mapped.orderNumber).toBe("#1001");
    expect(mapped.currency).toBe("EUR");
    expect(mapped.issueDate).toBeInstanceOf(Date);

    expect(mapped.buyer.name).toBe("Ada Lovelace");
    expect(mapped.buyer.address?.cityName).toBe("London");

    expect(mapped.lines).toHaveLength(2);
    const [firstLine, secondLine] = mapped.lines;
    expect(firstLine.unitPriceMinor).toBe(75000);
    expect(firstLine.quantity).toBe(2);
    expect(firstLine.vatRate).toBe(21);
    expect(firstLine.vatCategory).toBe("S");

    expect(secondLine.vatRate).toBe(6);
    expect(secondLine.vatCategory).toBe("S");
    expect(secondLine.discountMinor).toBe(2000);

    expect(mapped.meta?.source).toBe("shopify");
    expect(mapped.meta?.originalOrderId).toBe(4550001234);
  });

  it("falls back to defaults when tax data is missing", () => {
    const minimal = {
      id: 99,
      order_number: 99,
      created_at: "2025-02-01T10:00:00Z",
      currency: "EUR",
      line_items: [
        {
          title: "Zero VAT service",
          quantity: 1,
          price: "10.00"
        }
      ]
    };

    const result = shopifyToOrder(minimal, { supplier, defaultVatRate: 0 });
    expect(result.lines[0].vatRate).toBe(0);
    expect(result.lines[0].vatCategory).toBe("Z");
  });

  it("applies default VAT rate when no tax lines exist", () => {
    const order = {
      id: 501,
      order_number: 501,
      created_at: "2025-03-01T09:00:00Z",
      currency: "EUR",
      line_items: [
        {
          title: "Consulting Block",
          quantity: 1,
          price: "120.00",
          total_discount: "0.00"
        }
      ]
    };

    const mapped = shopifyToOrder(order, { supplier, defaultVatRate: 21 });
    expect(mapped.lines[0].vatRate).toBe(21);
    expect(mapped.lines[0].vatCategory).toBe("S");
  });

  it("rounds discounts and prices correctly", () => {
    const order = {
      id: 777,
      order_number: 777,
      created_at: "2025-03-05T10:00:00Z",
      currency: "EUR",
      line_items: [
        {
          title: "Subscription",
          quantity: 1,
          price: "19.995",
          total_discount: "0.995",
          tax_lines: [
            {
              rate: 0.06,
              price: "1.14"
            }
          ]
        }
      ]
    };

    const mapped = shopifyToOrder(order, { supplier, defaultVatRate: 6, currencyMinorUnit: 2 });
    expect(mapped.lines[0].unitPriceMinor).toBe(2000);
    expect(mapped.lines[0].discountMinor).toBe(100);
    expect(mapped.lines[0].vatRate).toBe(6);
    expect(mapped.lines[0].vatCategory).toBe("S");
  });
});
