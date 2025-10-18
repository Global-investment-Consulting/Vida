# VIDA MVP (file store)
[![CI](https://github.com/Global-investment-Consulting/Vida/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Global-investment-Consulting/Vida/actions/workflows/ci.yml)

## Run
```bash
cp .env.example .env
npm install
npm start
```

## Configuration
| Variable | Purpose |
| --- | --- |
| `VIDA_API_KEYS` | Comma-separated API keys allowed to access POST endpoints (e.g. `/webhook/order-created`). |
| `VIDA_HISTORY_DIR` | Override directory for JSONL history logs (defaults to `./data/history`). |
| `VIDA_PEPPOL_SEND` | When `true`, enables Access Point delivery (stub integration scaffold). |
| `VIDA_PEPPOL_AP` | Access Point mode (defaults to `stub`). |

## Useful Commands
- `npm run history:list` – print the most recent webhook history entries.

## Docker

Build an image and run it locally:

```bash
docker build -t vida:dev .
VIDA_API_KEYS=dev-key docker run --rm -p 8080:3001 vida:dev
```

Or with Compose for persistent history:

```bash
docker compose up --build
```

The container exposes the API on port `8080` and mounts `./data` for history logs.

## Quickstart (staging)

Use the [OpenAPI spec](openapi.js) for field details. The sample payload in [`examples/order.sample.json`](examples/order.sample.json) matches the `/api/invoice` schema. Staging runs at **https://vida-staging.fly.dev**.

Example request payload:

```json
{
  "orderNumber": "INV-2025-0001",
  "currency": "EUR",
  "issueDate": "2025-02-01",
  "buyer": {
    "name": "Acme GmbH",
    "endpoint": { "id": "9915:acme", "scheme": "9915" },
    "address": { "streetName": "Alexanderplatz 1", "cityName": "Berlin", "postalZone": "10178", "countryCode": "DE" }
  },
  "supplier": {
    "name": "Vida Demo BV",
    "vatId": "BE0123456789",
    "endpoint": { "id": "0088:vida", "scheme": "0088" }
  },
  "lines": [
    { "description": "Consulting retainer", "quantity": 1, "unitPriceMinor": 50000, "vatRate": 21 }
  ],
  "defaultVatRate": 21
}
```

```bash
# create a BIS 3.0-valid UBL from an order
curl -sS https://vida-staging.fly.dev/api/invoice \
  -H "Authorization: Bearer $VIDA_TOKEN" \
  -H "Content-Type: application/json" \
  --data @examples/order.sample.json > invoice.xml

# validate result is XML
grep -q "<Invoice" invoice.xml && echo "OK: UBL created"
```

Snippet of the XML you should receive:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:CustomizationID>urn:peppol.eu:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>INV-2025-0001</cbc:ID>
  ...
</Invoice>
```

422 example

```json
{
  "code": "BIS_RULE_VIOLATION",
  "message": "BuyerParty identifier is required",
  "field": "buyerParty.identifier",
  "ruleId": "BIS-III-PEPPOL-01"
}
```

- Auth: pass either the staging JWT or API key via `Authorization: Bearer …`. Missing/invalid tokens return `401/403`.
- BIS validation errors map to `message` (human readable), `field` (dot-path), and optional `ruleId` returned by the validator.
- Common pitfalls: omit buyer endpoint IDs, send currency codes outside ISO 4217, or forget to align `vatRate` with `buyer` country — the validator will reject those.
