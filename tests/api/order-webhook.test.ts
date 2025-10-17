import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../../src/server";

const shopifyFixturePath = path.resolve(__dirname, "../connectors/fixtures/shopify-order.json");
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

const createdFiles: string[] = [];

afterEach(async () => {
  while (createdFiles.length > 0) {
    const file = createdFiles.pop();
    if (!file) continue;
    await rm(file, { force: true }).catch(() => undefined);
  }
});

describe("POST /webhook/order-created", () => {
  it("normalises a Shopify order, creates XML, and returns the file path", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    expect(response.body).toEqual({
      path: expect.stringContaining(path.join("output", "invoice_")),
      xmlLength: expect.any(Number)
    });

    const generatedPath = response.body.path as string;
    createdFiles.push(generatedPath);
    const stats = await stat(generatedPath);
    expect(stats.isFile()).toBe(true);
    expect(response.body.xmlLength).toBeGreaterThan(0);
  });

  it("rejects invalid payloads", async () => {
    await request(app)
      .post("/webhook/order-created")
      .send({ source: "shopify" })
      .expect(400);
  });
});
