// src/routes_v1.js
import express from 'express';
import { authMw } from './mw_auth.js';
import { idemMw } from './mw_idempotency.js';
import { store } from './store.js';
import { buildUblXml } from './xml.js';
import { buildPdf } from './pdf.js';

const router = express.Router();

// All v1 endpoints require auth (header OR access_token query)
router.use(authMw);

// List
router.get('/invoices', async (req, res) => {
  const { limit, q, status } = req.query;
  const list = await store.listInvoices({ limit, q, status });
  res.json({ data: list });
});

// Create (idempotent)
router.post('/invoices', idemMw('create'), express.json(), async (req, res) => {
  const idemKey = req.idemKey; // from middleware
  const inv = await store.createInvoice(req.body || {}, idemKey);
  res.json(inv);
});

// Fetch one
router.get('/invoices/:id', async (req, res) => {
  const inv = await store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  res.json(inv);
});

// Patch (SENT only)
router.patch('/invoices/:id', express.json(), async (req, res) => {
  const inv = await store.patchInvoice(req.params.id, req.body || {});
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  res.json(inv);
});

// XML (auth via header or ?access_token=)
router.get('/invoices/:id/xml', async (req, res) => {
  const inv = await store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  const xml = buildUblXml(inv);
  res.type('application/xml').send(xml);
});

// PDF
router.get('/invoices/:id/pdf', async (req, res) => {
  const inv = await store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  const pdfBuffer = await buildPdf(inv);
  res.type('application/pdf').send(pdfBuffer);
});

// Pay (idempotent)
router.post('/invoices/:id/pay', idemMw('pay'), async (req, res) => {
  const idemKey = req.idemKey;
  const inv = await store.markPaid(req.params.id, idemKey);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  res.json(inv);
});

// Payments list
router.get('/invoices/:id/payments', async (req, res) => {
  const items = await store.listPayments(req.params.id);
  res.json({ data: items });
});

export default router;
