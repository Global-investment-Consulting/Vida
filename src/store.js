// src/store.js
import fs from 'fs';

import { DATA_PATH } from './config.js';

function load() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify({ seq: 1, invoices: {}, payments: {}, idem: { create: {}, pay: {} } }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}
function save(db) { fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2)); }

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

export const store = {
  db: load(),

  persist() { save(this.db); },

  nextNumber() { const s = String(this.db.seq++).padStart(5, '0'); this.persist(); return `2025-${s}`; },

  createInvoice(body) {
    const number = this.nextNumber();
    const id = `inv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    const lines = (body.lines || []).map(l => ({
      name: String(l.name || 'Service'),
      qty: Number(l.qty || 1),
      price: Number(l.price || 0)
    }));
    const net = round2(lines.reduce((sum, l) => sum + l.qty * l.price, 0));
    const tax = round2(net * 0.21);
    const gross = round2(net + tax);

    const inv = {
      id, number,
      currency: body.currency || 'EUR',
      buyer: { name: body.buyer?.name || '', country: body.buyer?.country || 'BE', vat: body.buyer?.vat || '' },
      lines,
      net, tax, gross,
      status: 'SENT',
      createdAt: new Date().toISOString(),
      issuedAt: new Date().toISOString()
    };

    this.db.invoices[id] = inv;
    this.persist();
    return inv;
  },

  getInvoice(id) { return this.db.invoices[id] || null; },

  listInvoices({ limit = 50, q = '', status } = {}) {
    let arr = Object.values(this.db.invoices).sort((a, b) => a.number.localeCompare(b.number));
    if (q) {
      const s = q.toLowerCase();
      arr = arr.filter(x => (x.buyer?.name || '').toLowerCase().includes(s) || (x.number || '').toLowerCase().includes(s));
    }
    if (status) arr = arr.filter(x => x.status === status);
    return arr.slice(0, Number(limit) || 50);
  },

  patchInvoice(id, patch) {
    const inv = this.getInvoice(id);
    if (!inv) return null;
    if (inv.status !== 'SENT') return { error: 'only_sent' };
    if (patch.buyer) inv.buyer = { ...inv.buyer, ...patch.buyer };
    this.persist();
    return inv;
  },

  addPayment(id) {
    const inv = this.getInvoice(id);
    if (!inv) return null;
    inv.status = 'PAID';
    const pay = {
      id: inv.id,              // reuse invoice id (simple MVP)
      invoiceId: inv.id,
      amount: inv.gross,
      paymentMethod: 'manual',
      paidAt: new Date().toISOString()
    };
    this.db.payments[id] = this.db.payments[id] || [];
    this.db.payments[id].push(pay);
    this.persist();
    return { inv, pay };
  },

  listPayments(id) { return this.db.payments[id] || []; },

  idemGet(kind, key) { return this.db.idem?.[kind]?.[key] || null; },
  idemSet(kind, key, value) {
    this.db.idem[kind] = this.db.idem[kind] || {};
    this.db.idem[kind][key] = value;
    this.persist();
  }
};
