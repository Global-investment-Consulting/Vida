import crypto from "node:crypto";
import { loadDb, saveDb } from "./storage.js";
import { calcTotals } from "./tax.js";

let db = loadDb();

export function getIdem(scope, key) {
  return db.idem?.[scope]?.[key] || null;
}
export function setIdem(scope, key, payload) {
  if (!db.idem[scope]) db.idem[scope] = {};
  db.idem[scope][key] = payload;
  saveDb(db);
}

export function createInvoice(payload) {
  const id = `inv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const number = nextNumber();

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const totals = calcTotals(lines, 0.21);

  const inv = {
    id,
    number,
    currency: payload.currency || "EUR",
    buyer: payload.buyer || { name: "", country: "" },
    lines,
    ...totals,
    status: "SENT",
    issuedAt: new Date().toISOString()
  };

  db.invoices[id] = inv;
  saveDb(db);
  return inv;
}

function nextNumber() {
  // e.g., 2025-00001
  const year = new Date().getFullYear();
  const seq = db.seq || 1;
  const padded = String(seq).padStart(5, "0");
  db.seq = seq + 1;
  saveDb(db);
  return `${year}-${padded}`;
}

export function getInvoice(id) {
  return db.invoices[id] || null;
}

export function listInvoices({ limit = 50, q = "", status } = {}) {
  let arr = Object.values(db.invoices);

  if (q) {
    const needle = q.toLowerCase();
    arr = arr.filter((i) =>
      (i.buyer?.name || "").toLowerCase().includes(needle) ||
      (i.number || "").toLowerCase().includes(needle)
    );
  }
  if (status) {
    arr = arr.filter((i) => i.status === status);
  }

  arr.sort((a, b) => (a.number > b.number ? -1 : 1));
  return arr.slice(0, Number(limit) || 50);
}

export function patchInvoice(id, patch) {
  const inv = db.invoices[id];
  if (!inv) return null;
  if (inv.status !== "SENT") {
    return { error: { type: "invalid_state", message: "Only SENT invoices can be patched" } };
  }
  if (patch.buyer) inv.buyer = { ...inv.buyer, ...patch.buyer };
  if (Array.isArray(patch.lines)) {
    inv.lines = patch.lines;
    const totals = calcTotals(inv.lines, 0.21);
    inv.net = totals.net; inv.tax = totals.tax; inv.gross = totals.gross;
  }
  saveDb(db);
  return inv;
}

export function markPaid(id, payment) {
  if (!db.payments[id]) db.payments[id] = [];
  const exists = db.payments[id].some(
    (p) => p.paidAt === payment.paidAt && p.amount === payment.amount
  );
  if (!exists) db.payments[id].push(payment);

  const inv = db.invoices[id];
  if (inv) {
    inv.status = "PAID";
    inv.paidAt = payment.paidAt;
  }
  saveDb(db);
}

export function getPayments(id) {
  return db.payments[id] || [];
}

export function newPayment(inv) {
  return {
    id: inv.id, // keeping same id to make idempotency obvious in logs
    amount: inv.gross,
    paymentMethod: "CARD",
    paidAt: new Date().toISOString()
  };
}
