// src/routes_v1.js
import express from 'express';
import { prisma } from './db.js';
import authMiddleware from './mw_auth.js';
import { makeInvoiceXml } from './ubl.js'; // ensure ubl.js exports makeInvoiceXml

const router = express.Router();

// Apply auth to all /v1 routes
router.use(authMiddleware);

// --- Helper: simple per-tenant per-year invoice number (e.g., 2025-00001)
async function nextInvoiceNumber(prismaClient, tenantId) {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;

  const last = await prismaClient.invoice.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  let seq = 1;
  if (last?.number) {
    const m = last.number.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }

  return `${year}-${String(seq).padStart(5, '0')}`;
}

// -------- Invoices --------

// List invoices
router.get('/invoices', async (req, res) => {
  try {
    const items = await prisma.invoice.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
      include: { lines: true },
    });
    return res.json({ object: 'list', data: items });
  } catch (err) {
    console.error('[GET /invoices] error:', err);
    return res.status(500).json({ error: { type: 'internal_error', message: 'Failed to list invoices' } });
  }
});

// Create invoice
router.post('/invoices', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.currency) {
      return res.status(400).json({ error: { type: 'invalid_request_error', message: 'currency is required' } });
    }

    const number = await nextInvoiceNumber(prisma, req.tenantId);

    const invoice = await prisma.invoice.create({
      data: {
        tenantId: req.tenantId,
        number, // REQUIRED by schema
        currency: body.currency,

        buyerName: body.buyer?.name ?? null,
        buyerVatId: body.buyer?.vat_id ?? null,
        buyerCountry: body.buyer?.country ?? null,
        buyerAddress1: body.buyer?.address1 ?? null,
        buyerCity: body.buyer?.city ?? null,

        lines: {
          create: (body.lines ?? []).map((l, i) => ({
            name: String(l.name ?? `Item ${i + 1}`),
            qty: Number(l.qty ?? 1),
            unit: String(l.unit ?? 'EA'),
            price: Number(l.price ?? 0),
            net: Number((Number(l.qty ?? 1) * Number(l.price ?? 0)).toFixed(2)),
          })),
        },
      },
      include: { lines: true },
    });

    // Totals (very simple VAT logic: 21% if BE/FR and no buyer VAT; else 0%)
    const isConsumerBEorFR = ['BE', 'FR'].includes(invoice.buyerCountry ?? '');
    const vatRate = isConsumerBEorFR ? 0.21 : 0;
    const net = invoice.lines.reduce((s, ln) => s + Number(ln.net ?? 0), 0);
    const tax = Number((net * vatRate).toFixed(2));
    const gross = Number((net + tax).toFixed(2));

    // Optionally persist calculated totals if your schema has fields; otherwise just return them
    return res.status(201).json({
      id: invoice.id,
      number: invoice.number,
      status: 'SENT',
      totals: { net, tax, gross },
      vat_rate: vatRate,
    });
  } catch (err) {
    console.error('[POST /invoices] error:', err);
    return res.status(500).json({ error: { type: 'internal_error', message: 'Failed to create invoice' } });
  }
});

// Invoice details
router.get('/invoices/:id', async (req, res) => {
  try {
    const inv = await prisma.invoice.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { lines: true },
    });
    if (!inv) return res.status(404).json({ error: { type: 'invalid_request_error', message: 'Invoice not found' } });
    return res.json(inv);
  } catch (err) {
    console.error('[GET /invoices/:id] error:', err);
    return res.status(500).json({ error: { type: 'internal_error', message: 'Failed to fetch invoice' } });
  }
});

// UBL/XML for an invoice
router.get('/invoices/:id/xml', async (req, res) => {
  try {
    const inv = await prisma.invoice.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
      include: { lines: true },
    });
    if (!inv) return res.status(404).json({ error: { type: 'invalid_request_error', message: 'Invoice not found' } });

    // Minimal seller/buyer objects for makeInvoiceXml helper
    const seller = {
      name: 'Demo Seller Ltd',
      endpoint_id: '1234567890123',
      vat_id: 'BE0123456789',
      country: 'BE',
      address1: 'Main Street 1',
      city: 'Brussels',
      postal: '1000',
      region: 'Brussels-Capital',
      iban: 'BE12345678901234',
    };

    const buyer = {
      name: inv.buyerName,
      vat_id: inv.buyerVatId,
      country: inv.buyerCountry,
      address1: inv.buyerAddress1,
      city: inv.buyerCity,
    };

    const xml = makeInvoiceXml(inv, seller, buyer, inv.lines);

    res.set('Content-Type', 'application/xml; charset=utf-8');
    return res.send(xml);
  } catch (err) {
    console.error('[GET /invoices/:id/xml] error:', err);
    return res.status(500).json({ error: { type: 'internal_error', message: 'Failed to render XML' } });
  }
});

export default router;
