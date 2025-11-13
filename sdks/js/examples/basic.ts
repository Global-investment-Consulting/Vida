import { createVidaClient, type InvoiceSubmission } from "../src/index.js";

async function main() {
  const client = createVidaClient({
    apiKey: process.env.VIDA_PUBLIC_API_KEY || "demo-key",
    baseUrl: process.env.VIDA_API_BASE || "http://localhost:3001"
  });

  const payload: InvoiceSubmission = {
    externalReference: "INV-2025-0001",
    currency: "EUR",
    issueDate: new Date().toISOString().slice(0, 10),
    seller: {
      name: "Vida Supplier BV",
      vatId: "BE0123456789",
      endpoint: { scheme: "0208", id: "0755799452" }
    },
    buyer: {
      name: "Acme BV",
      endpoint: { scheme: "0208", id: "0999999999" }
    },
    lines: [
      {
        description: "Retainer",
        quantity: 1,
        unitPriceMinor: 120000,
        vatRate: 21
      }
    ]
  };

  const submission = await client.submitInvoice(payload);
  console.log("Invoice submitted:", submission);

  const status = await client.getInvoiceStatus(submission.invoiceId);
  console.log("Latest status:", status);
}

main().catch((error) => {
  console.error("SDK example failed", error);
  process.exit(1);
});
