// server.js (ESM)
import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import v1 from './src/routes_v1.js';
import openapi from './openapi.js';
import swaggerUi from 'swagger-ui-express';

const app = express();
const PORT = process.env.PORT || 3001;

// ----- utils for __dirname in ESM -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- middleware -----
app.use(express.json());

// Compact request log with method, path, status, bytes, time
app.use(
  morgan((tokens, req, res) => {
    const ts = new Date().toISOString();
    const method = tokens.method(req, res);
    const url = tokens.url(req, res);
    const status = tokens.status(req, res);
    const len = tokens.res(req, res, 'content-length') || '-';
    const ms = tokens['response-time'](req, res);
    return `${ts} ${method} ${url} ${status} ${len} - ${ms} ms reqId=-`;
  })
);

// ----- static dashboard -----
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Small endpoint the dashboard uses to know the API is alive
app.get('/demo-config', (_req, res) => {
  // keep the payload tiny; the UI only checks that it 200s
  const token = process.env.API_KEY || '';
  res.json({ ok: true, tokenHint: token ? 'present' : '' });
});

// ----- OpenAPI & Docs -----
app.get('/openapi.json', (_req, res) => {
  res.type('application/json').send(openapi);
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

// ----- API v1 -----
app.use('/v1', v1);

// ----- health (optional, handy for Docker/uptime) -----
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ----- start server unless running tests -----
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`\nAPI running on http://localhost:${PORT}`);
    console.log(`- New Stripe-like API at /v1`);
    console.log(`- OpenAPI spec at /openapi.json`);
    console.log(`- Swagger UI docs at /docs`);
  });
}

// Export the app for Vitest/Supertest
export default app;
