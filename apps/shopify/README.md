## Shopify Bridge (Vida)

Lightweight Express app that receives Shopify order webhooks, verifies the HMAC header, maps the payload to Vida's public invoice DTO, and forwards it to `/v0/invoices`.

### Prerequisites

- Node 20+
- `ngrok` (for local webhook tunneling)
- Shopify Store with `orders/create` webhook subscription

### Setup

```bash
cd apps/shopify
npm install
cp .env.example .env
# fill in VIDA_PUBLIC_API_KEY, VIDA_PUBLIC_API_URL, SHOPIFY_WEBHOOK_SECRET
npm run dev
```

Expose the server to Shopify:

```bash
PORT=4001 npm run ngrok
```

Use the printed HTTPS URL to configure the webhook destination (`https://<ngrok>/webhooks/orders`).

### Generate Vida payloads from sample orders

```bash
npm run payload ./fixtures/order.json
# or
cat fixtures/order.json | npm run payload
```

### Environment variables

| Name | Description |
| --- | --- |
| `VIDA_PUBLIC_API_KEY` | Public API key provisioned for your tenant |
| `VIDA_PUBLIC_API_URL` | Vida API base URL (defaults to `http://localhost:3001`) |
| `SHOPIFY_WEBHOOK_SECRET` | Shared secret used to validate Shopify webhooks |
| `VIDA_SELLER_NAME` | Optional override for the seller name in the generated invoice |
| `VIDA_SELLER_ENDPOINT_ID/SCHEME` | Optional Peppol endpoint overrides |
