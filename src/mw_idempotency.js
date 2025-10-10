// src/mw_idempotency.js
export function idemMw(scope) {
  return (req, res, next) => {
    const key = req.get('X-Idempotency-Key');
    if (!key) {
      return res.status(400).json({ error: { type: 'bad_request', message: 'Missing X-Idempotency-Key' } });
    }
    req.idemKey = `${scope}:${key}`;
    next();
  };
}
