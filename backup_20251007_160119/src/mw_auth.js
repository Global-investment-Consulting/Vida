// src/mw_auth.js
import { prisma } from './db.js';

/**
 * Auth middleware for /v1 routes.
 * Accepts either:
 *   - Authorization: Bearer <API_KEY>
 *   - X-Api-Key: <API_KEY>
 *
 * Attaches:
 *   req.apiKey    -> ApiKey row
 *   req.tenant    -> Tenant row (loaded by tenantId)
 *   req.tenantId  -> string
 */
export default async function mwAuth(req, res, next) {
  try {
    const auth = req.get('Authorization') || '';
    const bearer = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : null;

    const headerKey = req.get('X-Api-Key');
    const key = (bearer || headerKey || '').trim();

    if (!key) {
      return res.status(401).json({
        error: { type: 'authentication_error', message: 'Missing API key' },
      });
    }

    // NOTE: current schema has NO relation include here
    const apiKey = await prisma.apiKey.findUnique({
      where: { key },
    });

    if (!apiKey) {
      return res.status(401).json({
        error: { type: 'authentication_error', message: 'Invalid API key' },
      });
    }

    const headerTenantId = req.get('X-Tenant-Id');
    if (headerTenantId && headerTenantId !== apiKey.tenantId) {
      return res.status(403).json({
        error: {
          type: 'authorization_error',
          message: 'API key does not belong to the provided tenant',
        },
      });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: apiKey.tenantId },
    });

    if (!tenant) {
      return res.status(403).json({
        error: {
          type: 'authorization_error',
          message: 'Tenant not found for API key',
        },
      });
    }

    req.apiKey = apiKey;
    req.tenant = tenant;
    req.tenantId = apiKey.tenantId;

    return next();
  } catch (err) {
    console.error('[authMiddleware] error:', err);
    return res.status(500).json({
      error: { type: 'internal_error', message: 'Auth failed' },
    });
  }
}
