import express from "express";
import { authMw } from "./mw_auth.js";
import { idemMw } from "./mw_idempotency.js";
import {
  createInvoice, getInvoice, listInvoices, patchInvoice,
  newPayment, markPaid, getPayments
} from "./store.js";
import { buildUblXml } from "./xml.js";
import { buildPdfStream } from "./pdf.js";

export default function v1() {
  const app = express.Router();

  // All routes require auth
  app.use(authMw);

  // Create (idempotent)
  app.post("/invoices", idemMw("create"), (req, res) => {
    const inv = createInvoice(req.body || {});
    return res.json(inv);
  });

  // Fetch one
  app.get("/invoices/:id", (req, res) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" }});
    return res.json(inv);
  });

  // List
  app.get("/invoices", (req, res) => {
    const { limit, q, status } = req.query;
    const data = listInvoices({ limit, q, status });
    return res.json({ data });
  });

  // Patch (only SENT)
  app.patch("/invoices/:id", (req, res) => {
    const id = req.params.id;
    const patched = patchInvoice(id, req.body || {});
    if (!patched) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" }});
    if (patched.error) return res.status(400).json(patched);
    return res.json(patched);
  });

  // XML
  app.get("/invoices/:id/xml", (req, res) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" }});
    const xml = buildUblXml(inv);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    return res.send(xml);
  });

  // PDF
  app.get("/invoices/:id/pdf", (req, res) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" }});
    res.setHeader("Content-Type", "application/pdf");
    const pdf = buildPdfStream(inv);
    pdf.pipe(res);
  });

  // Pay (idempotent)
  app.post("/invoices/:id/pay", idemMw("pay"), (req, res) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" }});

    const payment = newPayment(inv);
    markPaid(inv.id, payment);

    return res.json({ status: "PAID", ...payment });
  });

  // Payments list (ALWAYS array)
  app.get("/invoices/:id/payments", (req, res) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" }});
    const data = getPayments(inv.id) || [];
    return res.json({ data });
  });

  return app;
}
