// src/store.js
import { loadDb, saveDb } from "./storage.js";
import { VAT_RATE } from "./config.js";

function computeTotals(lines, currency) {
  const net = lines.reduce((sum, l) => sum + Number(l.qty) * Number(l.price), 0);
  const tax = Math.round(net * VAT_RATE * 100) / 100;
  const gross = Math.round((net + tax) * 100) / 100;
  return { currency, net, tax, gross };
}

export async function createInvoice(payload) {
  const { currency, buyer, lines } = payload;
  const db = await loadDb();

  const id = `inv_${Date.now()}_${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`;
  const number = `${new Date().getFullYear()}-${String(db.seq).padStart(5, "0")}`;

  const cleanedLines = (lines || []).map((l, i) => ({
    id: i + 1,
    name: String(l.name || "").trim() || `Item ${i + 1}`,
    qty: Number(l.qty || 1),
    price: Number(l.price || 0),
  }));

  const totals = computeTotals(cleanedLines, String(currency || "EUR").toUpperCase());

  const inv = {
    id,
    number,
    status: "SENT",
    buyer: {
      name: String(buyer?.name || "").trim(),
      country: String(buyer?.country || "").trim().toUpperCase(),
      vat: String(buyer?.vat || ""),
    },
    lines: cleanedLines,
    ...totals,
    issuedAt: new Date().toISOString(),
  };

  db.invoices[id] = inv;
  db.seq += 1;
  await saveDb(db);
  return inv;
}

export async function getInvoice(id) {
  const db = await loadDb();
  return db.invoices[id] || null;
}

export async function listInvoices({ q, limit = 50 } = {}) {
  const db = await loadDb();
  let arr = Object.values(db.invoices);
  if (q) {
    const needle = q.toLowerCase();
    arr = arr.filter((i) => i.buyer?.name?.toLowerCase().includes(needle) || i.number?.toLowerCase().includes(needle));
  }
  arr.sort((a, b) => (a.issuedAt > b.issuedAt ? -1 : 1));
  return { data: arr.slice(0, Number(limit) || 50) };
}

export async function patchInvoice(id, patch) {
  const db = await loadDb();
  const inv = db.invoices[id];
  if (!inv) return null;

  if (patch.buyer) {
    inv.buyer = {
      name: String(patch.buyer.name ?? inv.buyer.name ?? ""),
      country: String(patch.buyer.country ?? inv.buyer.country ?? "").toUpperCase(),
      vat: String(patch.buyer.vat ?? inv.buyer.vat ?? ""),
    };
  }
  if (Array.isArray(patch.lines)) {
    inv.lines = patch.lines.map((l, i) => ({
      id: i + 1,
      name: String(l.name || "").trim() || `Item ${i + 1}`,
      qty: Number(l.qty || 1),
      price: Number(l.price || 0),
    }));
    const totals = {
      net: inv.lines.reduce((s, l) => s + l.qty * l.price, 0),
      tax: Math.round(inv.lines.reduce((s, l) => s + l.qty * l.price, 0) * VAT_RATE * 100) / 100,
    };
    inv.net = totals.net;
    inv.tax = totals.tax;
    inv.gross = Math.round((totals.net + totals.tax) * 100) / 100;
  }
  await saveDb(db);
  return inv;
}

export async function payInvoice(id) {
  const db = await loadDb();
  const inv = db.invoices[id];
  if (!inv) return null;

  inv.status = "PAID";
  inv.paidAt = new Date().toISOString();

  // store a single payment line per invoice (idempotent behavior handled by middleware)
  db.payments[id] = {
    id,                       // mirrors invoice id (so idempotency returns same id)
    invoiceId: id,
    amount: inv.gross,
    paymentMethod: "CARD",
    createdAt: inv.paidAt,
    currency: inv.currency,
    status: "SUCCEEDED",
  };

  await saveDb(db);
  return { ...inv };
}

export async function listPayments(invoiceId) {
  const db = await loadDb();
  const p = db.payments[invoiceId];
  return { data: p ? [p] : [] };
}
