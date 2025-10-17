import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/server";

const shopifyFixturePath = path.resolve(__dirname, "../connectors/fixtures/shopify-order.json");
const wooFixturePath = path.resolve(__dirname, "../connectors/fixtures/woocommerce-order.json");
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
const fixedDate = new Date("2025-01-22T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(fixedDate);
});

afterEach(async () => {
  vi.useRealTimers();
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

    const expectedPath = path.resolve(
      process.cwd(),
      "output",
      "invoice_2025-01-22T12-00-00-000Z.xml"
    );

    expect(response.body).toEqual({
      path: expectedPath,
      xmlLength: expect.any(Number)
    });

    const generatedPath = response.body.path as string;
    createdFiles.push(generatedPath);
    const stats = await stat(generatedPath);
    expect(stats.isFile()).toBe(true);
    expect(response.body.xmlLength).toBeGreaterThan(0);
    const xml = await readFile(generatedPath, "utf8");
    expect(xml.startsWith("<?xml")).toBe(true);
    expect(xml.includes("<Invoice")).toBe(true);
  });

  it("normalises a WooCommerce order, creates XML, and returns the file path", async () => {
    const payload = JSON.parse(await readFile(wooFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .send({
        source: "woocommerce",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    const expectedPath = path.resolve(
      process.cwd(),
      "output",
      "invoice_2025-01-22T12-00-00-000Z.xml"
    );

    expect(response.body.path).toBe(expectedPath);
    expect(response.body.xmlLength).toBeGreaterThan(0);

    const generatedPath = response.body.path as string;
    createdFiles.push(generatedPath);
    const xml = await readFile(generatedPath, "utf8");
    expect(xml.includes("<cac:InvoiceLine>")).toBe(true);
  });

  it("rejects invalid payloads", async () => {
    await request(app)
      .post("/webhook/order-created")
      .send({ source: "shopify" })
      .expect(400);
  });

  it("returns 422 when mapper preconditions fail", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .send({
        source: "shopify",
        payload
      })
      .expect(422);

    expect(response.body.error).toMatch(/supplier/i);
  });
});
