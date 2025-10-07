// src/routes_v1.js
import express from "express";
import {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
  payInvoice,
  getPayments,
} from "./store.js";
import { buildUbl } from "./xml.js";
import { buildPdf } from "./pdf.js";

const router = express.Router();

// ---------- Auth middleware ----------
function needAuth(req, res, next) {
  const envKey = process.env.API_KEY || "key_test_12345";
  const isPdfPath = /\/pdf$/.test(req.path);
  const qToken = req.query.access_token;

  let ok = false;

  // Option 1: ?access_token= on PDF route
  if (isPdfPath && qToken && qToken === envKey) ok = true;

  // Option 2: Bearer header
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1] === envKey) ok = true;

  if (!ok) {
    return res
      .status(401)
      .json({ error: { type: "auth_error", message: "Invalid or missing API key" } });
  }
  next();
}

router.use(express.json());

// ---------- Create (idempotent) ----------
router.post("/invoices", needAuth, async (req, res) => {
  try {
    const idem = req.header("X-Idempotency-Key") || null;
    const inv = await createInvoice(req.body, idem);
    if (!inv) return res.status(500).json({ error: { type: "server_error", message: "create failed" } });
    res.json(inv);
  } catch (e) {
    console.error("create error:", e);
    res.status(500).json({ error: { type: "server_error", message: "create failed" } });
  }
});

// ---------- List ----------
router.get("/invoices", needAuth, async (req, res) => {
  try {
    const { q = "", limit = 50 } = req.query;
    const out = await listInvoices({ q, limit: Number(limit) || 50 });
    res.json(out);
  } catch (e) {
    console.error("list error:", e);
    res.status(500).json({ error: { type: "server_error", message: "list failed" } });
  }
});

// ---------- Get one ----------
router.get("/invoices/:id", needAuth, async (req, res) => {
  const inv = await getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
  res.json(inv);
});

// ---------- Patch (only when SENT) ----------
router.patch("/invoices/:id", needAuth, async (req, res) => {
  const updated = await updateInvoice(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
  if (updated.error === "locked") {
    return res.status(409).json({ error: { type: "conflict", message: "Cannot modify a PAID invoice" } });
  }
  res.json(updated);
});

// ---------- XML ----------
router.get("/invoices/:id/xml", needAuth, async (req, res) => {
  const inv = await getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });

  const xml = buildUbl(inv);
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.send(xml);
});

// ---------- PDF (tolerate stream OR buffer) ----------
router.get("/invoices/:id/pdf", needAuth, async (req, res) => {
  const inv = await getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });

  try {
    const pdf = await buildPdf(inv);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="invoice_${inv.number || "invoice"}.pdf"`
    );

    // If it's a PDFKit Document (stream), it will have .pipe()
    if (pdf && typeof pdf.pipe === "function") {
      pdf.pipe(res);
      pdf.end();          // we end the stream after piping
      return;
    }

    // Otherwise assume Buffer/string and send it
    const buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(String(pdf), "binary");
    res.end(buf);
  } catch (e) {
    console.error("pdf error:", e);
    res.status(500).json({ error: { type: "server_error", message: "pdf failed" } });
  }
});

// ---------- Pay (idempotent) ----------
router.post("/invoices/:id/pay", needAuth, async (req, res) => {
  const idem = req.header("X-Idempotency-Key") || null;
  const inv = await payInvoice(req.params.id, idem);
  if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
  res.json(inv);
});

// ---------- Payments list ----------
router.get("/invoices/:id/payments", needAuth, async (req, res) => {
  const inv = await getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: "not_found", message: "Invoice not found" } });
  const out = await getPayments(inv.id);
  res.json(out);
});

export default router;
