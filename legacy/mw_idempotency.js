// src/mw_idempotency.js
export default function idemMw(scope) {
  return (req, _res, next) => {
    // capture the header; store will enforce semantics
    req.idemScope = scope; // "create" | "pay"
    req.idemKey = req.get('X-Idempotency-Key') || null;
    next();
  };
}
