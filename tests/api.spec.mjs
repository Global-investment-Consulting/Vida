import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import app from "../server.js"; // Import the running Express app

// Shared headers
const AUTH = { Authorization: "Bearer key_test_12345" };

describe("VIDA MVP API (integration tests)", () => {
  let invoiceId;

  // --- 1) Create (idempotent) ---
  it("should create an invoice and respect idempotency", async () => {
    const idemKey = crypto.randomUUID();
    const body = {
      currency: "EUR",
      buyer: { name: "Test Co", country: "BE" },
      lines: [{ name: "Service", qty: 1, price: 50 }],
    };

    const r1 = await request(app)
      .post("/v1/invoices")
      .set(AUTH)
      .set("X-Idempotency-Key", idemKey)
      .send(body)
      .expect(200);

    const r2 = await request(app)
      .post("/v1/invoices")
      .set(AUTH)
      .set("X-Idempotency-Key", idemKey)
      .send(body)
      .expect(200);

    expect(r1.body.id).toBe(r2.body.id);
    invoiceId = r1.body.id;
  });

  // --- 2) Fetch + list ---
  it("should fetch and list invoices", async () => {
    const res = await request(app)
      .get(`/v1/invoices/${invoiceId}`)
      .set(AUTH)
      .expect(200);
    expect(res.body.id).toBe(invoiceId);

    const list = await request(app)
      .get("/v1/invoices?limit=5&q=test")
      .set(AUTH)
      .expect(200);
    expect(list.body.data).toBeInstanceOf(Array);
  });

  // --- 3) XML + PDF endpoints ---
  it("should return XML and PDF", async () => {
    await request(app)
      .get(`/v1/invoices/${invoiceId}/xml?access_token=key_test_12345`)
      .expect(200);

    await request(app)
      .get(`/v1/invoices/${invoiceId}/pdf?access_token=key_test_12345`)
      .expect(200);
  });

  // --- 4) Pay + payments list ---
  it("should mark invoice as paid and list payment", async () => {
    const idemPay = crypto.randomUUID();
    const pay1 = await request(app)
      .post(`/v1/invoices/${invoiceId}/pay`)
      .set(AUTH)
      .set("X-Idempotency-Key", idemPay)
      .expect(200);

    const pay2 = await request(app)
      .post(`/v1/invoices/${invoiceId}/pay`)
      .set(AUTH)
      .set("X-Idempotency-Key", idemPay)
      .expect(200);

    expect(pay1.body.id).toBe(pay2.body.id);
    expect(pay1.body.status).toBe("PAID");

    const plist = await request(app)
      .get(`/v1/invoices/${invoiceId}/payments`)
      .set(AUTH)
      .expect(200);

    expect(plist.body.data).toBeInstanceOf(Array);
    expect(plist.body.data.length).toBeGreaterThanOrEqual(1);
  });
});
