import { describe, it, expect } from "vitest";
import { parseOrder } from "../../src/schemas/order";

describe("Order schema", () => {
  it("parses a valid order", () => {
    const order = {
      orderNumber: "ORD-1001",
      currency: "EUR",
      issueDate: "2025-01-01",
      buyer: { name: "Buyer BV" },
      supplier: { name: "Supplier NV" },
      lines: [
        { description: "Consulting", quantity: 2, unitPriceMinor: 50000, vatRate: 21 },
        { description: "Hosting", quantity: 1, unitPriceMinor: 15000 }, // vatRate omitted -> allowed
      ],
    };
    const parsed = parseOrder(order);
    expect(parsed.orderNumber).toBe("ORD-1001");
    expect(parsed.lines.length).toBe(2);
  });

  it("rejects empty lines", () => {
    const invalid = {
      orderNumber: "ORD-1002",
      currency: "USD",
      issueDate: "2025-01-02",
      buyer: { name: "Buyer" },
      supplier: { name: "Supplier" },
      lines: [],
    };
    expect(() => parseOrder(invalid)).toThrow();
  });
});
