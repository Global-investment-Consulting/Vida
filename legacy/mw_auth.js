// src/mw_auth.js
import { API_KEY } from './config.js';

export function authMw(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token =
    (hdr.startsWith('Bearer ') ? hdr.slice(7) : null) ||
    (req.query.access_token ? String(req.query.access_token) : null);

  if (!token || token !== API_KEY) {
    return res.status(401).json({ error: { type: 'auth_error', message: 'Invalid or missing API key' } });
  }
  next();
}
