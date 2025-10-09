// src/mw_idempotency.js
export function idemMw(kind, store) {
  return (req, res, next) => {
    const key = req.headers['x-idempotency-key'];
    if (!key) return res.status(400).json({ error: { type: 'invalid_request', message: 'Missing X-Idempotency-Key' } });

    const hit = store.idemGet(kind, key);
    if (hit) return res.json(hit);
    req._idemKey = key;
    next();
  };
}
