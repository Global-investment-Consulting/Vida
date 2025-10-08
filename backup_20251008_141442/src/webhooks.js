import crypto from 'crypto';
import { prisma } from './db.js';

// Node 22 has global fetch; no import needed.

function sign(payload, secret) {
  const ts = Math.floor(Date.now()/1000).toString();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(ts + '.' + body).digest('hex');
  return { header: `t=${ts},v1=${sig}`, body };
}

export async function emitEvent(tenantId, type, data) {
  const payload = { id: crypto.randomUUID(), type, data, created_at: new Date().toISOString() };
  await prisma.event.create({ data: { tenantId, type, data: JSON.stringify(payload) }});

  const endpoints = await prisma.webhookEndpoint.findMany({ where: { tenantId, enabled: true }});
  const secret = process.env.WEBHOOK_SIGNING_SECRET || 'whsec_test_123';

  for (const ep of endpoints) {
    try {
      const { header, body } = sign(payload, secret);
      const r = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': header },
        body
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      console.error('Webhook failed', ep.url, e.message);
      await prisma.event.create({
        data: { tenantId, type: 'delivery.failed', data: JSON.stringify({ endpoint: ep.url, error: e.message }) }
      });
    }
  }
}
