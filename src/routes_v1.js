// src/routes_v1.js
import express from 'express';
import idemMw from './mw_idempotency.js';
import { buildXml, buildPdf } from './pdf.js';
import { TEST_ACCESS_TOKEN } from './config.js';
import {
  file_createInvoice,
  file_getInvoice,
  file_listInvoices,
  file_markInvoicePaid,
  file_listPayments
} from './store.js';

const router = express.Router();

// Create invoice (idempotent by header)
router.post('/invoices', idemMw('create'), async (req, res) => {
  const inv = await file_createInvoice(req.idemKey);
  res.json(inv);
});

// Fetch one
router.get('/invoices/:id', async (req, res) => {
  const inv = await file_getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  res.json(inv);
});

// List (limit & q)
router.get('/invoices', async (req, res) => {
  const { limit = 5, q = '' } = req.query;
  const list = await file_listInvoices({ limit, q });
  res.json({ data: list, has_more: false });
});

// XML (gated by test token)
router.get('/invoices/:id/xml', async (req, res) => {
  if ((req.query.access_token ?? '') !== TEST_ACCESS_TOKEN) {
    return res.status(403).json({ error: { type: 'forbidden', message: 'Bad token' } });
  }
  const inv = await file_getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  const xml = buildXml(inv);
  res.type('application/xml').send(xml);
});

// PDF (gated by test token)
router.get('/invoices/:id/pdf', async (req, res) => {
  if ((req.query.access_token ?? '') !== TEST_ACCESS_TOKEN) {
    return res.status(403).json({ error: { type: 'forbidden', message: 'Bad token' } });
  }
  const inv = await file_getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  const pdf = buildPdf(inv);
  res.type('application/pdf').send(pdf);
});

// Pay (idempotent by header); returns the invoice
router.post('/invoices/:id/pay', idemMw('pay'), async (req, res) => {
  const inv = await file_markInvoicePaid(req.params.id, req.idemKey);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'Invoice not found' } });
  res.json(inv);
});

// Payments for an invoice
router.get('/invoices/:id/payments', async (req, res) => {
  const items = await file_listPayments(req.params.id);
  res.json({ data: items, has_more: false });
});

export default router;
