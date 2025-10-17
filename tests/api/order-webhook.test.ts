import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/server";
import * as historyLogger from "../../src/history/logger";
import { listHistory } from "../../src/history/logger";
import * as validation from "../../src/validation/ubl";

const shopifyFixturePath = path.resolve(__dirname, "../connectors/fixtures/shopify-order.json");
const wooFixturePath = path.resolve(__dirname, "../connectors/fixtures/woocommerce-order.json");
const API_KEY = "test-key";
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
const apFiles: string[] = [];
const fixedDate = new Date("2025-01-22T12:00:00.000Z");
let historyDir: string;
let recordHistorySpy: ReturnType<typeof vi.spyOn>;
let validateUblSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(async () => {
  historyDir = await mkdtemp(path.join(tmpdir(), "vida-history-"));
  process.env.VIDA_HISTORY_DIR = historyDir;
  process.env.VIDA_API_KEYS = API_KEY;
  recordHistorySpy = vi.spyOn(historyLogger, "recordHistory");
  validateUblSpy = undefined;
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
  if (historyDir) {
    await rm(historyDir, { recursive: true, force: true }).catch(() => undefined);
  }
  recordHistorySpy.mockRestore();
  if (validateUblSpy) {
    validateUblSpy.mockRestore();
    validateUblSpy = undefined;
  }
  delete process.env.VIDA_HISTORY_DIR;
  delete process.env.VIDA_API_KEYS;
  delete process.env.VIDA_PEPPOL_SEND;
  delete process.env.VIDA_PEPPOL_OUTBOX_DIR;
  delete process.env.VIDA_VALIDATE_UBL;
  while (apFiles.length > 0) {
    const file = apFiles.pop();
    if (!file) continue;
    await rm(file, { force: true }).catch(() => undefined);
  }
});

describe("POST /webhook/order-created", () => {
  it("normalises a Shopify order, creates XML, and returns the file path", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", API_KEY)
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

    const history = await listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("ok");
    expect(history[0].invoicePath).toBe(expectedPath);
    expect(history[0].source).toBe("shopify");
  });

  it("normalises a WooCommerce order, creates XML, and returns the file path", async () => {
    const payload = JSON.parse(await readFile(wooFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", API_KEY)
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

    const history = await listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("ok");
    expect(history[0].source).toBe("woocommerce");
  });

  it("sends the invoice to the PEPPOL stub when enabled", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    const outboxDir = await mkdtemp(path.join(tmpdir(), "vida-ap-"));
    process.env.VIDA_PEPPOL_SEND = "true";
    process.env.VIDA_PEPPOL_OUTBOX_DIR = outboxDir;

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    const expectedOutboxFile = path.join(outboxDir, "#1001.xml");
    apFiles.push(expectedOutboxFile);
    const stats = await stat(expectedOutboxFile);
    expect(stats.isFile()).toBe(true);

    const history = await listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].peppolStatus).toBe("SENT");
    expect(history[0].peppolId).toBe("#1001");
    expect(response.body.path).toContain("invoice_2025-01-22T12-00-00-000Z.xml");
  });

  it("rejects invalid payloads", async () => {
    await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", API_KEY)
      .send({ source: "shopify" })
      .expect(400);

    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "payload is required" })
    );
  });

  it("returns 422 when mapper preconditions fail", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", API_KEY)
      .send({
        source: "shopify",
        payload
      })
      .expect(422);

    expect(response.body.error).toMatch(/supplier/i);
    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: expect.stringMatching(/supplier/i) })
    );
  });

  it("returns 401 when API key is missing", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    await request(app)
      .post("/webhook/order-created")
      .send({
        source: "shopify",
        payload,
        supplier
      })
      .expect(401);

    expect(recordHistorySpy).not.toHaveBeenCalled();
  });

  it("returns 403 when API key is invalid", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));

    await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", "wrong-key")
      .send({
        source: "shopify",
        payload,
        supplier
      })
      .expect(403);

    expect(recordHistorySpy).not.toHaveBeenCalled();
  });

  it("validates UBL when flag enabled", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    process.env.VIDA_VALIDATE_UBL = "true";
    validateUblSpy = vi.spyOn(validation, "validateUbl");

    await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(200);

    expect(validateUblSpy).toHaveBeenCalled();
    const history = await listHistory();
    expect(history[0]?.validationErrors).toBeUndefined();
  });

  it("returns 422 when UBL validation fails", async () => {
    const payload = JSON.parse(await readFile(shopifyFixturePath, "utf8"));
    process.env.VIDA_VALIDATE_UBL = "true";
    validateUblSpy = vi.spyOn(validation, "validateUbl").mockReturnValue({
      ok: false,
      errors: [{ path: "/", msg: "Invalid UBL" }]
    });

    const response = await request(app)
      .post("/webhook/order-created")
      .set("x-vida-api-key", API_KEY)
      .send({
        source: "shopify",
        payload,
        supplier,
        defaultVatRate: 21
      })
      .expect(422);

    expect(response.body.error).toBe("UBL validation failed");
    expect(response.body.details).toEqual([{ path: "/", msg: "Invalid UBL" }]);
    expect(recordHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        validationErrors: [{ path: "/", msg: "Invalid UBL" }]
      })
    );
  });
});
