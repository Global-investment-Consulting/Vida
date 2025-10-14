// server.js — ViDA MVP API (ESM)
// -----------------------------------------------------------------------------
// Requirements:
//   - "type": "module" in package.json
//   - npm i express cors pdfkit
// Start:
//   npm start
//
// API:
//   GET  /v1/invoices?limit=10           -> list invoices
//   POST /v1/invoices                    -> create invoice
//   GET  /v1/invoices/:id/pdf            -> professional PDF
//   GET  /v1/invoices/:id/xml            -> minimal XML
//
// Auth (either):
//   1) Authorization: Bearer <API_KEY>
//   2) ?access_token=<API_KEY>
//
// Demo defaults:
//   API_KEY = key_test_12345
// -----------------------------------------------------------------------------

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ----------------------------------------------------------------------------
// Basic middleware
// ----------------------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ----------------------------------------------------------------------------
const API_KEY = process.env.API_KEY || "key_test_12345";
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

// Ensure data dir
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load DB (in-memory with simple file persistence)
let db = { invoices: [] };
try {
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    if (!Array.isArray(db.invoices)) db.invoices = [];
  }
} catch (e) {
  console.error("Failed to read DB:", e);
}

function persist() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to write DB:", e);
  }
}

// ----------------------------------------------------------------------------
// Helper: auth Either (Bearer header OR access_token query)
// ----------------------------------------------------------------------------
function authEither(req, res, next) {
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const token = req.query.access_token || bearer;
  if (!token || token !== API_KEY) {
    return res.status(401).json({
      error: { type: "unauthorized", message: "Missing or invalid API key" },
    });
  }
  next();
}

// ----------------------------------------------------------------------------
// Helper: Find invoice by ID or number (case-insensitive)
// ----------------------------------------------------------------------------
function findInvoiceByIdOrNumber(idOrNum) {
  const needle = String(idOrNum).toLowerCase();
  return db.invoices.find(
    (inv) =>
      String(inv.id).toLowerCase() === needle ||
      String(inv.number || "").toLowerCase() === needle
  );
}

// ----------------------------------------------------------------------------
// Helper: Create nice, sequential invoice numbers (YYYY-#####)
// ----------------------------------------------------------------------------
function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const sameYear = db.invoices
    .filter((i) => String(i.number || "").startsWith(String(year)))
    .map((i) => parseInt(String(i.number).split("-")[1] || "0", 10))
    .filter((n) => !Number.isNaN(n));

  const maxSeq = sameYear.length > 0 ? Math.max(...sameYear) : 0;
  const nextSeq = (maxSeq + 1).toString().padStart(5, "0");
  return `${year}-${nextSeq}`;
}

// ----------------------------------------------------------------------------
// Normalizer for POST /v1/invoices (keeps it simple & safe)
// Body example:
// {
//   "externalId":"ext_abc",
//   "currency":"EUR",
//   "buyer": { "name":"Test Buyer", "vatId":"BE0123456789", "email":"buyer@example.com"},
//   "lines":[ { "description":"Service", "quantity":1, "unitPriceMinor":12345, "vatRate":21 } ]
// }
// ----------------------------------------------------------------------------
function normalizeInvoice(payload = {}) {
  const id = `inv_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const number = nextInvoiceNumber();
  const currency = payload.currency || "EUR";
  const lines = Array.isArray(payload.lines) ? payload.lines : [];

  let totalMinor = 0;
  lines.forEach((l) => {
    const qty = Number(l.quantity || 1);
    const unit = Number(l.unitPriceMinor || 0);
    totalMinor += qty * unit;
  });

  return {
    id,
    number,
    status: "draft",
    currency,
    createdAt: new Date().toISOString(),
    externalId: payload.externalId || null,
    buyer: payload.buyer || { name: "Unknown" },
    buyerName: (payload.buyer && payload.buyer.name) || "Unknown",
    lines,
    totalMinor,
    gross: totalMinor, // alias used by your dashboard
  };
}

// ----------------------------------------------------------------------------
// Professional PDF rendering with PDFKit
// ----------------------------------------------------------------------------
async function renderInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ---- Header
    doc
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("INVOICE", { align: "right" })
      .moveDown(0.5);

    // Seller / Company box
    const companyName = "ViDA Demo Ltd.";
    const companyAddr = ["123 Demo Street", "1000 Brussels", "Belgium"].join("\n");
    const companyVat = "BE0123.456.789";

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(companyName)
      .font("Helvetica")
      .text(companyAddr)
      .text(`VAT: ${companyVat}`);

    // Invoice meta
    doc
      .moveDown(1)
      .font("Helvetica-Bold")
      .text("Invoice Details", { continued: false })
      .moveDown(0.3)
      .font("Helvetica")
      .text(`Invoice ID: ${inv.id}`)
      .text(`Invoice Number: ${inv.number}`)
      .text(`Status: ${inv.status}`)
      .text(`Date: ${new Date(inv.createdAt || Date.now()).toLocaleDateString()}`);

    // Buyer box
    doc
      .moveDown(1)
      .font("Helvetica-Bold")
      .text("Bill To")
      .moveDown(0.3)
      .font("Helvetica");
    const b = inv.buyer || {};
    const buyerBlock = [
      b.name || inv.buyerName || "Unknown",
      b.company ? b.company : "",
      b.email ? `Email: ${b.email}` : "",
      b.vatId ? `VAT: ${b.vatId}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    doc.text(buyerBlock);

    // ---- Table Header
    doc.moveDown(1.2);
    const tableTop = doc.y;
    const col = {
      desc: 40,
      qty: 360,
      unit: 420,
      total: 500,
    };

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Description", col.desc, tableTop)
      .text("Qty", col.qty, tableTop, { width: 40, align: "right" })
      .text("Unit (minor)", col.unit, tableTop, { width: 70, align: "right" })
      .text("Line Total", col.total, tableTop, { width: 80, align: "right" });

    const lineY = tableTop + 15;
    doc
      .moveTo(40, lineY)
      .lineTo(555, lineY)
      .lineWidth(0.7)
      .strokeColor("#333")
      .stroke();

    // ---- Lines
    doc.font("Helvetica").fontSize(11);
    let y = lineY + 8;
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    lines.forEach((l, idx) => {
      const qty = Number(l.quantity || 1);
      const unit = Number(l.unitPriceMinor || 0);
      const total = qty * unit;

      doc.text(l.description || `Item ${idx + 1}`, col.desc, y, { width: 300 });
      doc.text(qty.toString(), col.qty, y, { width: 40, align: "right" });
      doc.text(unit.toString(), col.unit, y, { width: 70, align: "right" });
      doc.text(total.toString(), col.total, y, { width: 80, align: "right" });

      y += 18;
      if (y > 740) {
        doc.addPage();
        y = 60;
      }
    });

    // Separator before totals
    doc
      .moveTo(360, y + 4)
      .lineTo(555, y + 4)
      .lineWidth(0.7)
      .strokeColor("#333")
      .stroke();

    // Totals block
    const totalsTop = y + 12;
    const labelW = 100;
    const valueW = 80;

    function rightText(label, value, bold = false) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").text(label, 360, doc.y, {
        width: labelW,
        align: "right",
      });
      doc.text(value, 360 + labelW + 10, doc.y - 11, { width: valueW, align: "right" });
      doc.moveDown(0.2);
    }

    doc.y = totalsTop;
    rightText("Subtotal:", inv.totalMinor.toString());
    // This demo does not calculate VAT breakdown — keep simple:
    rightText("VAT:", "0");
    rightText("Total:", inv.totalMinor.toString(), true);

    // Footer
    doc
      .moveDown(2)
      .fontSize(9)
      .fillColor("#666")
      .text(
        "Thank you for your business. Payment due within 30 days.",
        40,
        770,
        { align: "center", width: 515 }
      );

    doc.end();
  });
}

// ----------------------------------------------------------------------------
// XML rendering (simple)
// ----------------------------------------------------------------------------
function renderInvoiceXml(inv) {
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
  <ID>${esc(inv.id)}</ID>
  <Number>${esc(inv.number)}</Number>
  <Status>${esc(inv.status)}</Status>
  <Buyer>${esc(inv.buyerName || inv.buyer?.name)}</Buyer>
  <Currency>${esc(inv.currency)}</Currency>
  <TotalMinor>${inv.totalMinor}</TotalMinor>
</Invoice>`;
}

// ----------------------------------------------------------------------------
// API routes
// ----------------------------------------------------------------------------

// Simple homepage so / shows where to look
app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ViDA API</title>
    <style>
      body{font-family:system-ui,Arial,sans-serif;padding:24px;line-height:1.5}
      code{background:#f6f8fa;padding:2px 6px;border-radius:4px}
    </style>
  </head>
  <body>
    <h1>ViDA API</h1>
    <p>Server is running on <code>http://localhost:${PORT}</code>.</p>
    <ul>
      <li><a href="/openapi.json">/openapi.json</a> — minimal OpenAPI</li>
      <li><code>GET /v1/invoices?limit=1</code> — use Authorization header (Bearer)</li>
    </ul>
    <p><strong>Documents</strong> (require API key):</p>
    <pre>/v1/invoices/:id/pdf
/v1/invoices/:id/xml</pre>
    <p>Auth: Authorization: Bearer &lt;API_KEY&gt; or <code>?access_token=KEY</code></p>
  </body>
</html>`);
});

// Minimal openapi stub (kept for your link on the home page)
app.get("/openapi.json", (req, res) => {
  res.json({
    openapi: "3.0.0",
    info: { title: "ViDA MVP", version: "0.1.0" },
    paths: {
      "/v1/invoices": {
        get: { summary: "List invoices" },
        post: { summary: "Create invoice" },
      },
      "/v1/invoices/{id}/pdf": { get: { summary: "Get invoice PDF" } },
      "/v1/invoices/{id}/xml": { get: { summary: "Get invoice XML" } },
    },
  });
});

// List
app.get("/v1/invoices", authEither, (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
  const items = db.invoices
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  res.json({ data: items });
});

// Create
app.post("/v1/invoices", authEither, (req, res) => {
  const inv = normalizeInvoice(req.body || {});
  db.invoices.push(inv);
  persist();
  res.status(201).json({ id: inv.id, number: inv.number, ...inv });
});

// PDF
app.get("/v1/invoices/:id/pdf", authEither, async (req, res) => {
  const inv = findInvoiceByIdOrNumber(req.params.id);
  if (!inv) {
    return res
      .status(404)
      .json({ error: { type: "not_found", message: "Invoice not found" } });
  }
  try {
    const buf = await renderInvoicePdf(inv);
    const filename = `${inv.number || inv.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    console.error("PDF error:", e);
    res.status(500).json({ error: { type: "pdf_error", message: "Failed to render PDF" } });
  }
});

// XML
app.get("/v1/invoices/:id/xml", authEither, (req, res) => {
  const inv = findInvoiceByIdOrNumber(req.params.id);
  if (!inv) {
    return res
      .status(404)
      .json({ error: { type: "not_found", message: "Invoice not found" } });
  }
  const xml = renderInvoiceXml(inv);
  const filename = `${inv.number || inv.id}.xml`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.send(xml);
});

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`
API running on http://localhost:${PORT}
- New Stripe-like API at /v1
- OpenAPI spec at /openapi.json
`);
});
