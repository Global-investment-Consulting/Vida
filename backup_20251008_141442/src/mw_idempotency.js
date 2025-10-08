// src/mw_idempotency.js
import { loadDb, saveDb } from "./storage.js";

export function idemMw(kind) {
  // kind: "create" | "pay"
  return async (req, res, next) => {
    try {
      const key = req.get("X-Idempotency-Key");
      if (!key) return res.status(400).json({ error: { type: "bad_request", message: "Missing X-Idempotency-Key" } });

      const db = await loadDb();
      db.idem ||= { create: {}, pay: {} };

      const bucket = db.idem[kind] || {};
      const hits = bucket[key];
      if (hits) {
        // return the stored response again
        return res.status(200).json(hits);
      }

      // stash a helper to save result once handler finishes
      res.locals.__saveIdem = async (payload) => {
        const fresh = await loadDb();
        fresh.idem ||= { create: {}, pay: {} };
        fresh.idem[kind] ||= {};
        fresh.idem[kind][key] = payload;
        await saveDb(fresh);
      };

      next();
    } catch (e) {
      next(e);
    }
  };
}
