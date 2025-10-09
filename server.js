// server.js
import express from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import v1 from './src/routes_v1.js';
import openapi from './openapi.js'; // ✅ added safely

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(morgan('dev'));
app.use(express.static('public'));

// Root route (Dashboard)
app.get('/', (req, res) => {
  res.sendFile(new URL('./public/index.html', import.meta.url).pathname);
});

// Demo config (for dashboard JS)
app.get('/demo-config', (req, res) => {
  res.json({ demo: true });
});

// v1 API routes
app.use('/v1', v1);

// ✅ Serve OpenAPI specification
app.get('/openapi.json', (req, res) => {
  res.type('application/json').send(openapi);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: { type: 'server_error', message: err.message || 'Internal Server Error' },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\nAPI running on http://localhost:${PORT}`);
  console.log('- New Stripe-like API at /v1');
});
