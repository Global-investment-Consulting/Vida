// server.js
import express from 'express';
import cors from 'cors';
import v1 from './src/routes_v1.js';
import { PORT } from './src/config.js';

const app = express();
app.use(cors());
app.use(express.json());

// Stripe-like API at /v1
app.use('/v1', v1);

// Optional landing
app.get('/', (_req, res) => {
  res.json({
    hello: 'VIDA MVP',
    v1: '/v1',
    docs: '/docs',
  });
});

// export app for vitest (supertest)
export default app;

// only listen when not under vitest
if (!process.env.VITEST_WORKER_ID) {
  app.listen(PORT, () => {
    console.log('');
    console.log(`API running on http://localhost:${PORT}`);
    console.log('- New Stripe-like API at /v1');
    console.log('- OpenAPI spec at /openapi.json');
    console.log('- Swagger UI docs at /docs');
    console.log('');
  });
}
