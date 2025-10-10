// src/store.js
import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { USE_DB, VAT_RATE, resolveFileDbPath } from './config.js';

let prisma = null;
if (USE_DB) {
  const { PrismaClient } = await import('@prisma/client');
  prisma = new PrismaClient();
}

function nowIsoDate() {
  return new Date().toISOString();
}
function isoDateOnly(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

// -------------------------
// FILE STORE IMPLEMENTATION
// -------------------------
async function readJson() {
  const fs = await import('fs/promises');
  const p = resolveFileDbPath();
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { seq: 1, invoices: {}, payments: {}, idem: { create: {}, pay: {} } };
  }
}
async function writeJson(db) {
  const fs = await import('fs/promises');
  const path = resolveFileDbPath();
  await fs.mkdir(path.replace(/\\/g, '/').split('/').slice(0, -1).join('/'), { recursive: true });
  await fs.writeFile(path, JSON.stringify(db, null, 2), 'utf8');
}
function computeTotals(lines, vatRate = VAT_RATE) {
  const net = lines.reduce((sum, l) => sum.plus(new Decimal(l.qty).times(l.price)), new Decimal(0));
  const tax = net.times(vatRate);
  const gross = net.plus(tax);
  return {
    net: net.toNumber(),
    tax: tax.toNumber(),
    gross: gross.toNumber(),
  };
}
function nextNumber(seq) {
  return new Intl.NumberFormat('en-GB', { minimumIntegerDigits: 5, useGrouping: false })
    .format(seq);
}
function makeInvoiceId() {
  return `inv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

const fileStore = {
  async createInvoice(body, idemKey) {
    const db = await readJson();
    if (idemKey && db.idem.create[idemKey]) {
      const id = db.idem.create[idemKey];
      return db.invoices[id];
    }
    const id = makeInvoiceId();
    const number = `${new Date().getFullYear()}-${nextNumber(db.seq++)}`;
    const lines = body.lines || [];
    const totals = computeTotals(lines);
    const inv = {
      id, number, status: 'SENT',
      currency: body.currency || 'EUR',
      buyer: { name: body.buyer?.name || 'Unknown', country: body.buyer?.country || 'BE' },
      lines,
      net: totals.net, tax: totals.tax, gross: totals.gross,
      issuedAt: body.issuedAt || nowIsoDate(),
      createdAt: nowIsoDate(), updatedAt: nowIsoDate(),
    };
    db.invoices[id] = inv;
    if (idemKey) db.idem.create[idemKey] = id;
    await writeJson(db);
    return inv;
  },

  async getInvoice(id) {
    const db = await readJson();
    return db.invoices[id] || null;
  },

  async listInvoices({ limit = 50, q = '', status } = {}) {
    const db = await readJson();
    let arr = Object.values(db.invoices);
    if (q) {
      const qq = String(q).toLowerCase();
      arr = arr.filter(i =>
        i.number.toLowerCase().includes(qq) ||
        i.buyer?.name?.toLowerCase().includes(qq)
      );
    }
    if (status) arr = arr.filter(i => i.status === status);
    arr.sort((a, b) => b.number.localeCompare(a.number));
    return arr.slice(0, Number(limit));
  },

  async patchInvoice(id, patch) {
    const db = await readJson();
    const inv = db.invoices[id];
    if (!inv) return null;
    if (inv.status !== 'SENT') return inv; // no-op when not SENT
    if (patch.buyer) inv.buyer = { ...inv.buyer, ...patch.buyer };
    if (patch.lines) {
      inv.lines = patch.lines;
      const totals = computeTotals(inv.lines);
      inv.net = totals.net; inv.tax = totals.tax; inv.gross = totals.gross;
    }
    inv.updatedAt = nowIsoDate();
    db.invoices[id] = inv;
    await writeJson(db);
    return inv;
  },

  async markPaid(id, idemKey) {
    const db = await readJson();
    const inv = db.invoices[id];
    if (!inv) return null;

    if (idemKey && db.idem.pay[idemKey]) {
      // idempotent: return same invoice (already paid)
      return db.invoices[id];
    }
    // Create a payment record
    const payId = inv.id; // keep it simple: same id for idempotency
    db.payments[payId] = {
      id: payId,
      invoiceId: inv.id,
      amount: inv.gross,
      paymentMethod: 'manual',
      paidAt: nowIsoDate(),
    };
    inv.status = 'PAID';
    inv.updatedAt = nowIsoDate();
    db.invoices[id] = inv;
    if (idemKey) db.idem.pay[idemKey] = payId;
    await writeJson(db);
    return inv;
  },

  async listPayments(invoiceId) {
    const db = await readJson();
    const items = Object.values(db.payments).filter(p => p.invoiceId === invoiceId);
    return items;
  },
};

// -------------------------
// PRISMA STORE (DB) IMPLEMENTATION
// -------------------------
const dbStore = {
  async createInvoice(body, idemKey) {
    // idempotency for "create"
    if (idemKey) {
      const existing = await prisma.idempotencyKey.findUnique({ where: { key: idemKey } });
      if (existing && existing.scope === 'create') {
        const inv = await prisma.invoice.findUnique({ where: { id: existing.objectId }, include: { lines: true } });
        if (inv) return toApiInvoice(inv);
      }
    }
    const id = randomUUID();
    const number = `${new Date().getFullYear()}-${nextNumber(Date.now() % 100000)}`;
    const lines = body.lines || [];
    const totals = computeTotals(lines);
    const inv = await prisma.invoice.create({
      data: {
        id, number, status: 'SENT',
        currency: body.currency || 'EUR',
        buyerName: body.buyer?.name || 'Unknown',
        buyerCountry: body.buyer?.country || 'BE',
        net: new Decimal(totals.net),
        tax: new Decimal(totals.tax),
        gross: new Decimal(totals.gross),
        issuedAt: new Date(body.issuedAt || nowIsoDate()),
        lines: {
          createMany: {
            data: lines.map(l => ({
              id: randomUUID(),
              name: l.name,
              qty: l.qty,
              price: new Decimal(l.price),
            })),
          },
        },
      },
      include: { lines: true },
    });

    if (idemKey) {
      await prisma.idempotencyKey.create({
        data: { key: idemKey, scope: 'create', objectId: id },
      });
    }
    return toApiInvoice(inv);
  },

  async getInvoice(id) {
    const inv = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!inv) return null;
    return toApiInvoice(inv);
  },

  async listInvoices({ limit = 50, q = '', status } = {}) {
    const where = {};
    if (q) {
      where.OR = [
        { number: { contains: q, mode: 'insensitive' } },
        { buyerName: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (status) where['status'] = status;
    const list = await prisma.invoice.findMany({
      where,
      orderBy: { number: 'desc' },
      take: Number(limit),
      include: { lines: true },
    });
    return list.map(toApiInvoice);
  },

  async patchInvoice(id, patch) {
    const inv = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
    if (!inv) return null;
    if (inv.status !== 'SENT') return toApiInvoice(inv);

    let toUpdate = {};
    if (patch.buyer) {
      toUpdate.buyerName = patch.buyer.name ?? inv.buyerName;
      toUpdate.buyerCountry = patch.buyer.country ?? inv.buyerCountry;
    }
    if (patch.lines) {
      const totals = computeTotals(patch.lines);
      toUpdate.net = new Decimal(totals.net);
      toUpdate.tax = new Decimal(totals.tax);
      toUpdate.gross = new Decimal(totals.gross);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (patch.lines) {
        await tx.lineItem.deleteMany({ where: { invoiceId: id } });
        await tx.lineItem.createMany({
          data: patch.lines.map(l => ({
            id: randomUUID(),
            invoiceId: id,
            name: l.name,
            qty: l.qty,
            price: new Decimal(l.price),
          })),
        });
      }
      return tx.invoice.update({
        where: { id },
        data: toUpdate,
        include: { lines: true },
      });
    });

    return toApiInvoice(updated);
  },

  async markPaid(id, idemKey) {
    // idempotency for pay
    if (idemKey) {
      const existing = await prisma.idempotencyKey.findUnique({ where: { key: idemKey } });
      if (existing && existing.scope === 'pay') {
        const inv = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
        if (inv) return toApiInvoice(inv);
      }
    }
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) return null;

    const payId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          id: payId,
          invoiceId: id,
          amount: inv.gross,
          paymentMethod: 'manual',
          paidAt: new Date(),
        },
      });
      await tx.invoice.update({ where: { id }, data: { status: 'PAID' } });
      if (idemKey) {
        await tx.idempotencyKey.create({
          data: { key: idemKey, scope: 'pay', objectId: payId },
        });
      }
    });

    const fresh = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
    return toApiInvoice(fresh);
  },

  async listPayments(invoiceId) {
    const rows = await prisma.payment.findMany({
      where: { invoiceId },
      orderBy: { paidAt: 'asc' },
    });
    return rows.map(p => ({
      id: p.id,
      invoiceId: p.invoiceId,
      amount: Number(p.amount),
      paymentMethod: p.paymentMethod,
      paidAt: p.paidAt.toISOString(),
    }));
  },
};

// DB ➜ API shape adapter (to match file store)
function toApiInvoice(inv) {
  const lines = (inv.lines || []).map(l => ({
    name: l.name, qty: l.qty, price: Number(l.price),
  }));
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    currency: inv.currency,
    buyer: { name: inv.buyerName, country: inv.buyerCountry },
    lines,
    net: Number(inv.net),
    tax: Number(inv.tax),
    gross: Number(inv.gross),
    issuedAt: (inv.issuedAt instanceof Date ? inv.issuedAt.toISOString() : inv.issuedAt),
    createdAt: (inv.createdAt instanceof Date ? inv.createdAt.toISOString() : inv.createdAt),
    updatedAt: (inv.updatedAt instanceof Date ? inv.updatedAt.toISOString() : inv.updatedAt),
  };
}

// Export the selected store
export const store = USE_DB ? dbStore : fileStore;
export default store;
