// src/routes_v1.js
import { Router } from "express";
import { authMw } from "./mw_auth.js";
import { idemMw } from "./mw_idempotency.js";
import {
  createInvoice,
  getInvoice,
  listInvoices,
  patchInvoice,
  payInvoice,
  listPayments,
} from "./store.js";
import { buildUblXml } from "./xml.js";
import { buildPdfStream } from "./pdf.js";

const router = Router();

// list
router.get("/invoices", authMw, async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    const out = await listInvoices({ q, limit });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

// create (idempotent)
router.post("/invoices", authMw, idemMw("create"), async (req, res, next) => {
  try {
    const inv = await createInvoice(req.body || {});
    await res.locals.__saveIdem?.(inv);
    res.json(inv);
  } catch (e) {
    next(e);
  }
});

// get one
router.get("/invoices/:id", authMw, async (req, res, next) => {
  try {
    const inv = await getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
    res.json(inv);
  } catch (e) {
    next(e);
  }
});

// patch while SENT
router.patch("/invoices/:id", authMw, async (req, res, next) => {
  try {
    const inv = await patchInvoice(req.params.id, req.body || {});
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
    res.json(inv);
  } catch (e) {
    next(e);
  }
});

// XML
router.get("/invoices/:id/xml", authMw, async (req, res, next) => {
  try {
    const inv = await getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
    const xml = buildUblXml(inv);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
  } catch (e) {
    next(e);
  }
});

// PDF (either header auth or ?access_token= works due to authMw)
router.get("/invoices/:id/pdf", authMw, async (req, res, next) => {
  try {
    const inv = await getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice_${inv.number}.pdf"`);

    const pdf = buildPdfStream(inv);
    pdf.pipe(res);
  } catch (e) {
    next(e);
  }
});

// pay (idempotent)
router.post("/invoices/:id/pay", authMw, idemMw("pay"), async (req, res, next) => {
  try {
    const inv = await payInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
    await res.locals.__saveIdem?.(inv);
    res.json(inv);
  } catch (e) {
    next(e);
  }
});

// payments list
router.get("/invoices/:id/payments", authMw, async (req, res, next) => {
  try {
    const out = await listPayments(req.params.id);
    res.json(out);
  } catch (e) {
    next(e);
  }
});

export default router;
