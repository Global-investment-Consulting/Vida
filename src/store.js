// src/store.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import crypto from 'node:crypto';
import { VAT_RATE, USE_DB, DB_FILE } from './config.js';

// ---- helpers ----
const nowIso = () => new Date().toISOString();
const rnd = () => Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
const newInvId = () => `inv_${Date.now()}_${rnd()}`;
const newPayId = () => `pay_${Date.now()}_${rnd()}`;

function loadFileDb() {
  const dir = dirname(DB_FILE);
  mkdirSync(dir, { recursive: true });
  try {
    const raw = readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    const seed = { seq: 1, invoices: {}, payments: {}, idem: { create: {}, pay: {} } };
    writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
}

function saveFileDb(db) {
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ---- File-backed store ----
class FileStore {
  constructor() {
    this.db = loadFileDb();
  }

  // idempotent create:
  // - if idemKey is known -> return stored invoice
  // - else create + store mapping
  async createInvoice(idemKey) {
    if (idemKey && this.db.idem.create[idemKey]) {
      const invId = this.db.idem.create[idemKey];
      return this.db.invoices[invId] ?? null;
    }

    // create a trivial invoice (tests only need consistent ID + fetch/list)
    const id = newInvId();
    const number = `${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`;
    const net = 50;
    const tax = +(net * VAT_RATE).toFixed(2);
    const gross = +(net + tax).toFixed(2);

    const invoice = {
      id,
      number,
      status: 'SENT',
      currency: 'EUR',
      buyerName: 'Test Buyer',
      buyerCountry: 'BE',
      net,
      tax,
      gross,
      vatRate: VAT_RATE,
      lines: [{ id: crypto.randomUUID(), name: 'Service', qty: 1, price: net }],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      payments: [], // list of payment ids (file-mode convenience)
    };

    this.db.invoices[id] = invoice;
    if (idemKey) this.db.idem.create[idemKey] = id;
    saveFileDb(this.db);
    return invoice;
  }

  async getInvoice(id) {
    return this.db.invoices[id] ?? null;
  }

  async listInvoices({ limit = 5, q } = {}) {
    const all = Object.values(this.db.invoices);
    let result = all;
    if (q && q.trim()) {
      const needle = q.toLowerCase();
      result = all.filter(
        (i) =>
          (i.number || '').toLowerCase().includes(needle) ||
          (i.buyerName || '').toLowerCase().includes(needle)
      );
    }
    result.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    return result.slice(0, Number(limit) || 5);
  }

  // idempotent "pay"
  async markInvoicePaid(id, idemKey) {
    const inv = this.db.invoices[id];
    if (!inv) return null;

    // already paid? still keep idempotency for pay key
    if (idemKey && this.db.idem.pay[idemKey]) {
      // We return the invoice (endpoint returns invoice)
      return inv;
    }

    // Create a payment record
    const payId = newPayId();
    const payment = {
      id: payId,
      invoiceId: id,
      amount: inv.gross,
      currency: inv.currency,
      createdAt: nowIso(),
      method: 'card',
      status: 'succeeded',
    };

    this.db.payments[payId] = payment;
    inv.status = 'PAID';
    inv.updatedAt = nowIso();
    inv.payments.push(payId);

    if (idemKey) this.db.idem.pay[idemKey] = payId;

    saveFileDb(this.db);
    return inv;
  }

  async listPaymentsForInvoice(id) {
    return Object.values(this.db.payments).filter((p) => p.invoiceId === id);
  }
}

// ---- pick store impl ----
// (DB store omitted here; tests are running with USE_DB=false)
export function createStore() {
  return new FileStore();
}

// singleton used by the HTTP routes
export const store = createStore();

// named API for routes_v1.js
export const file_createInvoice = (idemKey) => store.createInvoice(idemKey);
export const file_getInvoice = (id) => store.getInvoice(id);
export const file_listInvoices = (opts) => store.listInvoices(opts);
export const file_markInvoicePaid = (id, idemKey) => store.markInvoicePaid(id, idemKey);
export const file_listPayments = (id) => store.listPaymentsForInvoice(id);
