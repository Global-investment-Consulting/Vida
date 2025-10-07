import crypto from 'crypto';
import { prisma } from './db.js';

function hashBody(req) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(req.body || {}));
  return h.digest('hex');
}

export async function idempotencyMiddleware(req, res, next) {
  const idemKey = req.get('X-Idempotency-Key');
  if (!idemKey) return next(); // optional but recommended for POST
  const tenantId = req.tenant.id;
  const requestHash = hashBody(req);

  const existing = await prisma.idempotencyKey.findUnique({
    where: { tenantId_key: { tenantId, key: idemKey } }
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      return res.status(409).json({ error: { type: 'idempotency_error', message: 'Key re-used with different payload' }});
    }
    return res.status(200).type('application/json').send(existing.response);
  }

  const origJson = res.json.bind(res);
  res.json = async (payload) => {
    try {
      await prisma.idempotencyKey.create({
        data: {
          tenantId,
          key: idemKey,
          requestHash,
          response: JSON.stringify(payload),
          status: String(res.statusCode || 200)
        }
      });
    } catch (e) { console.error('Idempotency store error', e); }
    return origJson(payload);
  };

  next();
}
