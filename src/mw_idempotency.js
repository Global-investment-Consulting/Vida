import { getIdem, setIdem } from "./store.js";

// usage: idemMw("create") or idemMw("pay")
export function idemMw(scope) {
  return (req, res, next) => {
    const key = req.get("X-Idempotency-Key");
    if (!key) return next(); // allow, just not idempotent

    const hit = getIdem(scope, key);
    if (hit) {
      // "Replay" the previous response payload
      return res.json(hit);
    }

    // capture res.json() once; store payload after we send it
    const orig = res.json.bind(res);
    res.json = (payload) => {
      try {
        setIdem(scope, key, payload);
      } catch (_) {}
      return orig(payload);
    };

    next();
  };
}
