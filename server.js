// server.js
import express from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import v1 from './src/routes_v1.js';
import { version } from './src/version.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(morgan('dev'));
app.use(express.json());

// Static dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Health & version
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/version', (_req, res) => res.json({ version }));

// DEMO CONFIG for the browser UI (so it knows where to call and what API key to use)
app.get('/demo-config', (_req, res) => {
  // WARNING: Only for local demo. Do not expose secrets in production UI.
  res.json({
    apiBase: '/v1',
    apiKey: process.env.API_KEY || 'key_test_12345'
  });
});

// Mount API v1
app.use('/v1', v1);

// Not found
app.use((req, res) => {
  res.status(404).json({ error: { type: 'not_found', message: 'Route not found' } });
});

app.listen(PORT, () => {
  console.log(`\n\nAPI running on http://localhost:${PORT}\n- New Stripe-like API at /v1`);
});
