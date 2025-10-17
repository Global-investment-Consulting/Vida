import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { wooToOrder } from "../../src/connectors/woocommerce";

const fixturePath = path.resolve(__dirname, "fixtures", "woocommerce-order.json");

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

describe("wooToOrder", () => {
  it("maps a WooCommerce order into the internal Order schema", async () => {
    const raw = await readFile(fixturePath, "utf8");
    const wooOrder = JSON.parse(raw);

    const mapped = wooToOrder(wooOrder, { supplier, defaultVatRate: 21 });

    expect(mapped.orderNumber).toBe("1002");
    expect(mapped.currency).toBe("EUR");
    expect(mapped.issueDate).toBeInstanceOf(Date);

    expect(mapped.buyer.name).toBe("Grace Hopper");
    expect(mapped.buyer.address?.cityName).toBe("New York");
    expect(mapped.buyer.contact?.electronicMail).toBe("grace@example.com");

    expect(mapped.lines).toHaveLength(2);
    const [firstLine, secondLine] = mapped.lines;

    expect(firstLine.unitPriceMinor).toBe(50000);
    expect(firstLine.vatRate).toBe(21);
    expect(firstLine.vatCategory).toBe("S");

    expect(secondLine.quantity).toBe(12);
    expect(secondLine.discountMinor).toBe(6000);
    expect(secondLine.vatRate).toBe(6);
    expect(secondLine.vatCategory).toBe("AA");

    expect(mapped.meta?.source).toBe("woocommerce");
    expect(mapped.meta?.originalOrderId).toBe(8921);
  });

  it("falls back to defaults when taxes are missing", () => {
    const minimal = {
      id: 777,
      date_created: "2025-02-02T00:00:00Z",
      currency: "EUR",
      line_items: [
        {
          name: "Zero VAT item",
          quantity: 1,
          total: "10.00"
        }
      ]
    };

    const result = wooToOrder(minimal, { supplier, defaultVatRate: 0 });
    expect(result.lines[0].vatRate).toBe(0);
    expect(result.lines[0].vatCategory).toBe("Z");
  });
});
