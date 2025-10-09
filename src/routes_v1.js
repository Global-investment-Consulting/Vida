// src/routes_v1.js
import express from 'express';
import { authMw } from './mw_auth.js';
import { idemMw } from './mw_idempotency.js';
import { store } from './store.js';
import { buildUblXml } from './xml.js';
import { buildPdfStream } from './pdf.js';

const r = express.Router();

// ------- list
r.get('/invoices', authMw, (req, res) => {
  const { limit, q, status } = req.query;
  const data = store.listInvoices({ limit, q, status });
  res.json({ data });
});

// ------- create (idempotent)
r.post('/invoices', authMw, idemMw('create', store), (req, res) => {
  const inv = store.createInvoice(req.body || {});
  if (req._idemKey) store.idemSet('create', req._idemKey, inv);
  res.json(inv);
});

// ------- fetch
r.get('/invoices/:id', authMw, (req, res) => {
  const inv = store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'invoice not found' } });
  res.json(inv);
});

// ------- patch (only SENT)
r.patch('/invoices/:id', authMw, (req, res) => {
  const updated = store.patchInvoice(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: { type: 'not_found', message: 'invoice not found' } });
  if (updated.error === 'only_sent') return res.status(400).json({ error: { type: 'invalid_state', message: 'Only SENT invoices can be patched' } });
  res.json(updated);
});

// ------- XML
r.get('/invoices/:id/xml', authMw, (req, res) => {
  const inv = store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'invoice not found' } });
  const xml = buildUblXml(inv);
  res.type('application/xml').send(xml);
});

// ------- PDF
r.get('/invoices/:id/pdf', authMw, (req, res) => {
  const inv = store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: { type: 'not_found', message: 'invoice not found' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`);
  buildPdfStream(inv).pipe(res);
});

// ------- pay (idempotent)
r.post('/invoices/:id/pay', authMw, idemMw('pay', store), (req, res) => {
  const pair = store.addPayment(req.params.id);
  if (!pair) return res.status(404).json({ error: { type: 'not_found', message: 'invoice not found' } });
  if (req._idemKey) store.idemSet('pay', req._idemKey, pair.inv);
  res.json(pair.inv);
});

// ------- payments list
r.get('/invoices/:id/payments', authMw, (req, res) => {
  const data = store.listPayments(req.params.id);
  res.json({ data });
});

export default r;
