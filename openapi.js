export default {
  openapi: "3.0.0",
  info: { title: "VIDA MVP API", version: "1.0.0" },
  servers: [{ url: "http://localhost:3001/v1" }],
  paths: {
    "/invoices": {
      get: { summary: "List invoices", parameters: [
        { name: "limit", in: "query", schema: { type: "integer", default: 50 }},
        { name: "q", in: "query", schema: { type: "string" }},
        { name: "status", in: "query", schema: { type: "string", enum: ["SENT","PAID"] }}
      ]},
      post: { summary: "Create invoice (idempotent)" }
    },
    "/invoices/{id}": {
      get: { summary: "Fetch invoice", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }}]},
      patch: { summary: "Patch invoice (SENT only)" }
    },
    "/invoices/{id}/xml":     { get: { summary: "Download UBL XML" } },
    "/invoices/{id}/pdf":     { get: { summary: "Download PDF" } },
    "/invoices/{id}/pay":     { post:{ summary: "Pay invoice (idempotent)" } },
    "/invoices/{id}/payments":{ get: { summary: "List payments" } }
  }
};
