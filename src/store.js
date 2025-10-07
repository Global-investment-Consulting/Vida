// src/store.js
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

// ---- helpers -------------------------------------------------

async function readDB() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const db = JSON.parse(raw);
    // normalize structure
    db.seq ??= 1;
    db.invoices ??= {};
    db.payments ??= {};
    db.idem ??= { create: {}, pay: {} };
    db.idem.create ??= {};
    db.idem.pay ??= {};
    return db;
  } catch (e) {
    // initialize if missing or corrupted
    return {
      seq: 1,
      invoices: {},
      payments: {},
      idem: { create: {}, pay: {} },
    };
  }
}

async function writeDB(db) {
  const data = JSON.stringify(db, null, 2);
  await fs.writeFile(DB_PATH, data, "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function nextInvoiceNumber(seq) {
  const year = new Date().getFullYear();
  return `${year}-${String(seq).padStart(5, "0")}`;
}

function calcTotals(lines, currency) {
  const items = (lines ?? []).map(l => ({
    name: String(l.name ?? "Item"),
    qty: Number(l.qty ?? 1),
    price: Number(l.price ?? 0),
  }));

  const net = items.reduce((s, l) => s + l.qty * l.price, 0);
  const vatRate = 0.21; // 21% like your earlier runs
  const tax = +(net * vatRate).toFixed(2);
  const gross = +(net + tax).toFixed(2);

  return {
    currency: String(currency || "EUR"),
    net: +net.toFixed(2),
    tax,
    gross,
    items,
    vatRate,
  };
}

// ---- public API ----------------------------------------------

export async function createInvoice(payload, idemKey) {
  const db = await readDB();

  // idempotent create
  if (idemKey && db.idem.create[idemKey]) {
    const existingId = db.idem.create[idemKey];
    return db.invoices[existingId] ?? null;
  }

  const buyer = payload?.buyer ?? {};
  const lines = payload?.lines ?? [];
  const currency = payload?.currency ?? "EUR";

  const id = `inv_${Date.now()}_${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, "0")}`;

  const number = nextInvoiceNumber(db.seq);
  db.seq += 1;

  const totals = calcTotals(lines, currency);

  const invoice = {
    id,
    number,
    status: "SENT",
    issuedAt: nowIso(),
    currency: totals.currency,
    buyer: {
      name: String(buyer.name ?? ""),
      country: String(buyer.country ?? "").toUpperCase(),
      vat_id: String(buyer.vat_id ?? buyer.vatId ?? ""),
    },
    lines: totals.items,
    net: totals.net,
    tax: totals.tax,
    gross: totals.gross,
    meta: {},
  };

  db.invoices[id] = invoice;
  if (idemKey) db.idem.create[idemKey] = id;

  await writeDB(db);
  return invoice;
}

export async function getInvoice(id) {
  const db = await readDB();
  return db.invoices[id] ?? null;
}

export async function listInvoices({ q = "", limit = 50 } = {}) {
  const db = await readDB();
  const all = Object.values(db.invoices);
  const qq = String(q).trim().toLowerCase();

  const filtered = qq
    ? all.filter(inv => {
        return (
          inv.number?.toLowerCase().includes(qq) ||
          inv.buyer?.name?.toLowerCase().includes(qq)
        );
      })
    : all;

  // newest first
  filtered.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));

  return {
    data: filtered.slice(0, Number(limit) || 50),
    has_more: filtered.length > (Number(limit) || 50),
  };
}

export async function updateInvoice(id, patch) {
  const db = await readDB();
  const inv = db.invoices[id];
  if (!inv) return null;

  if (inv.status !== "SENT") {
    // cannot patch paid invoice
    return { error: "locked" };
  }

  const buyer = patch?.buyer ?? {};
  const lines = patch?.lines;

  // patch buyer
  if (buyer && typeof buyer === "object") {
    inv.buyer = {
      name: String(buyer.name ?? inv.buyer.name ?? ""),
      country: String(buyer.country ?? inv.buyer.country ?? "").toUpperCase(),
      vat_id: String(
        buyer.vat_id ?? buyer.vatId ?? inv.buyer.vat_id ?? ""
      ),
    };
  }

  // patch lines & totals if provided
  if (Array.isArray(lines)) {
    inv.lines = lines.map(l => ({
      name: String(l.name ?? "Item"),
      qty: Number(l.qty ?? 1),
      price: Number(l.price ?? 0),
    }));
    const totals = calcTotals(inv.lines, inv.currency);
    inv.net = totals.net;
    inv.tax = totals.tax;
    inv.gross = totals.gross;
  }

  db.invoices[id] = inv;
  await writeDB(db);
  return inv;
}

export async function payInvoice(id, idemKey) {
  const db = await readDB();
  const inv = db.invoices[id];
  if (!inv) return null;

  // idempotent pay
  if (idemKey && db.idem.pay[idemKey]) {
    const already = db.idem.pay[idemKey];
    return already; // already stored full invoice snapshot
  }

  inv.status = "PAID";
  inv.paidAt = nowIso();
  inv.paymentMethod = "manual";

  // create a payment record
  const pid = `pay_${Date.now()}_${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, "0")}`;

  const payment = {
    id: pid,
    invoiceId: id,
    amount: inv.gross,
    currency: inv.currency,
    paidAt: inv.paidAt,
    method: inv.paymentMethod,
  };

  db.payments[pid] = payment;
  db.invoices[id] = inv;

  // store idem snapshot as returned value
  if (idemKey) db.idem.pay[idemKey] = inv;

  await writeDB(db);
  return inv;
}

export async function getPayments(invoiceId) {
  const db = await readDB();
  const list = Object.values(db.payments).filter(p => p.invoiceId === invoiceId);
  // newest first
  list.sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1));
  return { data: list };
}

// seller profile used by XML/PDF
export const seller = {
  name: "VIDA SRL",
  country: "BE",
  vat_id: "BE0123.456.789",
};
