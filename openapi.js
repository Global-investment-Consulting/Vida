// openapi.js
export const openapi = {
  openapi: "3.0.3",
  info: { title: "ViDA API", version: "0.3.8" },
  servers: [{ url: "http://localhost:3001" }],
  paths: {
    "/v1/invoices": {
      get: {
        summary: "List invoices",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { name: "q", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" } }
      },
      post: {
        summary: "Create invoice (idempotent by externalId)",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { "201": { description: "Created" }, "200": { description: "Idempotent (existing)" } }
      }
    },
    "/v1/invoices/{id}": {
      get: {
        summary: "Get invoice by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } }
      }
    },
    "/v1/invoices/{ref}/pdf": {
      get: {
        summary: "Invoice PDF (auth via Bearer or ?access_token)",
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK (application/pdf)" },
          "403": { description: "Bad token" },
          "404": { description: "Not found" }
        }
      }
    },
    "/v1/invoices/{ref}/xml": {
      get: {
        summary: "Invoice UBL XML (auth via Bearer or ?access_token)",
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "OK (application/xml)" },
          "403": { description: "Bad token" },
          "404": { description: "Not found" }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      ApiKeyQuery: { type: "apiKey", in: "query", name: "access_token" },
      ApiKeyHeader: { type: "apiKey", in: "header", name: "Authorization" }
    }
  }
};
