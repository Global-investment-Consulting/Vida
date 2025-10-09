// server.js
import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

import v1 from './src/routes_v1.js';
import { API_KEY, PORT } from './src/config.js';
import openapi from './openapi.js';
import swaggerUi from 'swagger-ui-express';

const app = express();

// nice timestamped logs
morgan.token('reqid', (req) => req.id || '-');
app.use(morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms reqId=:reqid'));

app.use(express.json());

// static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// tiny config endpoint so the UI gets its token
app.get('/demo-config', (_req, res) => {
  res.json({ accessToken: API_KEY });
});

// API v1
app.use('/v1', v1);

// OpenAPI + Swagger UI
app.get('/openapi.json', (_req, res) => res.type('application/json').send(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

app.listen(PORT, () => {
  console.log(`\n\nAPI running on http://localhost:${PORT}`);
  console.log('- New Stripe-like API at /v1');
  console.log('- OpenAPI spec at /openapi.json');
  console.log('- Swagger UI docs at /docs\n');
});
