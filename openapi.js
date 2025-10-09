// openapi.js
const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'VIDA MVP API',
    version: '1.0.0',
    description: 'Minimal OpenAPI spec for the VIDA MVP (file store, /v1 endpoints)'
  },
  servers: [{ url: 'http://localhost:3001/v1' }],
  paths: {
    '/invoices': {
      get: {
        summary: 'List invoices',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['SENT', 'PAID'] } }
        ],
        responses: { 200: { description: 'Array of invoices' } },
        security: [{ bearerAuth: [] }]
      },
      post: {
        summary: 'Create invoice (idempotent)',
        requestBody: { required: true },
        responses: { 200: { description: 'Invoice created' } },
        security: [{ bearerAuth: [] }]
      }
    },
    '/invoices/{id}': {
      get: {
        summary: 'Fetch single invoice',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Invoice detail' } },
        security: [{ bearerAuth: [] }]
      },
      patch: {
        summary: 'Patch invoice (SENT only)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Updated invoice' } },
        security: [{ bearerAuth: [] }]
      }
    },
    '/invoices/{id}/xml': {
      get: {
        summary: 'Download UBL-style XML',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'UBL XML' } },
        security: [{ bearerAuth: [] }]
      }
    },
    '/invoices/{id}/pdf': {
      get: {
        summary: 'Download invoice PDF',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'PDF document' } },
        security: [{ bearerAuth: [] }]
      }
    },
    '/invoices/{id}/pay': {
      post: {
        summary: 'Mark invoice paid (idempotent)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Invoice paid' } },
        security: [{ bearerAuth: [] }]
      }
    },
    '/invoices/{id}/payments': {
      get: {
        summary: 'List payments for invoice',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Payments array' } },
        security: [{ bearerAuth: [] }]
      }
    }
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }
  }
};

export default openapi;
