# @vida/public-api-sdk

Tiny TypeScript helper for the Vida public `/v0` API.

## Quick start

```bash
cd sdks/js
npm install
npm run build
node dist/index.js
```

Using the client:

```ts
import { createVidaClient, type InvoiceSubmission } from "@vida/public-api-sdk";

const client = createVidaClient({
  apiKey: process.env.VIDA_PUBLIC_API_KEY!,
  baseUrl: "https://api.vida.build"
});

const payload: InvoiceSubmission = {
  currency: "EUR",
  issueDate: "2025-02-01",
  seller: { name: "Vida Supplier BV", endpoint: { scheme: "0208", id: "0755799452" } },
  buyer: { name: "Acme BV", endpoint: { scheme: "0208", id: "0999999999" } },
  lines: [{ description: "Subscription", quantity: 1, unitPriceMinor: 12500, vatRate: 21 }]
};

const submission = await client.submitInvoice(payload);
const status = await client.getInvoiceStatus(submission.invoiceId);
```

Run `npm run example` to execute the sample under `examples/basic.ts`.
