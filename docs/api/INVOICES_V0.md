# Invoices API v0

The v0 surface exposes a thin public slice for creating invoices, polling their Scrada status, and receiving webhook updates. All routes live under `/v0/**` on the existing service.

## Authentication

Provide the `VIDA_PUBLIC_API_KEY` via `Authorization: Bearer <key>`. Requests without the header or with the wrong token are rejected with `401`.

## POST /v0/invoices

Creates an invoice, builds a BIS 3 UBL document, and sends it through the Scrada adapter. The handler stores request/response artifacts under `data/history/<invoiceId>/`.

### Request

```json
{
  "externalReference": "INV-2025-0001",
  "currency": "EUR",
  "issueDate": "2025-02-01",
  "seller": {
    "name": "Vida Supplier BV",
    "vatId": "BE0123456789",
    "endpoint": { "scheme": "0208", "id": "0755799452" }
  },
  "buyer": {
    "name": "Acme GmbH",
    "endpoint": { "scheme": "0208", "id": "0999999999" }
  },
  "lines": [
    {
      "description": "Consulting services",
      "quantity": 1,
      "unitPriceMinor": 500000,
      "vatRate": 21
    }
  ]
}
```

### Response

```json
{
  "invoiceId": "01JAB0YH6X6Z3G6N8W9QJHQ0KQ",
  "documentId": "11111111-2222-3333-4444-555555555555",
  "status": "PENDING",
  "externalReference": "INV-2025-0001"
}
```

Artifacts saved:

| File | Description |
| --- | --- |
| `request.json` | Validated API payload + metadata |
| `patched.xml` | Final UBL sent to Scrada |
| `send.json` | Scrada send attempts + documentId |
| `status.json` | Latest Scrada status snapshot |

## GET /v0/invoices/:invoiceId

Returns the latest Scrada status for a previously created invoice. The handler refreshes the status from Scrada before serving data (best-effort) and falls back to the cached `status.json`.

```json
{
  "invoiceId": "01JAB0YH6X6Z3G6N8W9QJHQ0KQ",
  "documentId": "11111111-2222-3333-4444-555555555555",
  "status": "DELIVERED",
  "info": {
    "id": "11111111-2222-3333-4444-555555555555",
    "status": "Delivered",
    "attempt": 1,
    "...": "..."
  }
}
```

## POST /v0/webhooks/scrada

Scrada delivery notifications can be pushed to this endpoint using the `AP_WEBHOOK_SECRET` in the `x-scrada-webhook-secret` header. Payload shape:

```json
{
  "invoiceId": "01JAB0YH6X6Z3G6N8W9QJHQ0KQ",
  "documentId": "11111111-2222-3333-4444-555555555555",
  "status": "Delivered",
  "info": { "...": "raw Scrada fields" }
}
```

## POST /v0/webhooks/shopify

Receives `orders/create` or `orders/paid` webhooks from Shopify, verifies the HMAC header, maps the payload to the public invoice DTO, and calls `/v0/invoices` internally. Configure:

* `SHOPIFY_WEBHOOK_SECRET` – HMAC secret key
* `SCRADA_SUPPLIER_*` – supplier defaults reused from the Scrada adapter
* `SHOPIFY_SELLER_ENDPOINT_{SCHEME,ID}` / `SHOPIFY_BUYER_ENDPOINT_{SCHEME,ID}` – optional overrides for Peppol endpoint IDs

Response mirrors `POST /v0/invoices` with a `202`.

## Curl Example

```bash
curl -X POST https://<service-host>/v0/invoices \
  -H "Authorization: Bearer ${VIDA_PUBLIC_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @payload.json
```
