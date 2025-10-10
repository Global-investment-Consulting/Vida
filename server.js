// server.js
import express from 'express';
import morgan from 'morgan';
import { PORT } from './src/config.js';
import v1 from './src/routes_v1.js';

// OpenAPI & docs
import openapi from './openapi.js';
import swaggerUi from 'swagger-ui-express';

// Build the app
export const app = express();
export default app;

// Attach a lightweight request id (before morgan)
app.use((req, _res, next) => {
  req.reqId = req.headers['x-request-id'] || '-';
  next();
});

// Register the custom morgan token used in the format string
morgan.token('reqId', (req) => req.reqId || '-');

// Logging
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms reqId=:reqId'));

// Static dashboard
app.use(express.static('public'));

// Small demo endpoint the dashboard hits
app.get('/demo-config', (_req, res) => res.json({ ok: true }));

// API v1
app.use('/v1', v1);

// OpenAPI + Swagger UI
app.get('/openapi.json', (_req, res) => res.type('application/json').send(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

// Start server only outside of tests (Vitest sets VITEST_WORKER_ID)
if (!process.env.VITEST_WORKER_ID && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\n\nAPI running on http://localhost:${PORT}`);
    console.log('- New Stripe-like API at /v1');
    console.log('- OpenAPI spec at /openapi.json');
    console.log('- Swagger UI docs at /docs\n');
  });
}
