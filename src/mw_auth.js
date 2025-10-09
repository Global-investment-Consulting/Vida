// src/mw_auth.js
import { API_KEY } from './config.js';

export function authMw(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.replace(/^Bearer\s+/i, '');
  const token = bearer || req.query.access_token;

  if (!token || token !== API_KEY) {
    console.error('[Error] Invalid or missing API key');
    return res.status(401).json({ error: { type: 'auth_error', message: 'Invalid or missing API key' } });
  }
  next();
}
