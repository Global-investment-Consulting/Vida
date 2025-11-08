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
| `PORT` | Port the HTTP server listens on (defaults to `3001`). |
| `LOG_LEVEL` | Text log level for future structured logging (`info` by default). |
| `VIDA_HISTORY_DIR` | Override directory for JSONL history logs (defaults to `./data/history`). |
| `VIDA_VALIDATE_UBL` | When `true`, validates generated UBL before returning or queuing it. |
| `VIDA_PEPPOL_SEND` | When `true`, enables Access Point delivery (stub integration scaffold). |
| `VIDA_PEPPOL_AP` | Access Point mode (defaults to `stub`). |
| `VIDA_PEPPOL_OUTBOX_DIR` | Override directory for stub AP outbox files (defaults to `./data/ap-outbox`). |
| `AP_WEBHOOK_SECRET` | Shared secret used to verify `/ap/status-webhook` callbacks. |
| `VIDA_AP_ADAPTER` | AP adapter selector (`mock` by default, set to `billit` to enable the Billit integration). |
| `AP_PROVIDER` | Optional label for the active AP provider (use `billit` when enabled). |
| `AP_BASE_URL` | Base URL for the Billit API (e.g. `https://api.billit.be`). |
| `AP_API_KEY` | Billit API bearer token used when present. |
| `AP_CLIENT_ID` / `AP_CLIENT_SECRET` | Billit OAuth client credentials used when no API key is configured. |

## Storage Backends
- The default storage bundle writes JSONL files under `./data`. No configuration changes are required for local development or staging.
- Set `VIDA_STORAGE_BACKEND=prisma` to use the Prisma-backed stores. Provide a `DATABASE_URL` (e.g. `file:./dev.db` for SQLite or a Postgres connection URL) before starting the server. For Postgres, run Prisma commands with `PRISMA_SCHEMA_PATH=prisma/schema.postgres.prisma`.
- Staging keeps `VIDA_STORAGE_BACKEND=file`. Flip the variable only when a managed database and migrations are available.
- See [`docs/STORAGE.md`](docs/STORAGE.md) for setup instructions, migration commands, and backend switching guidance.

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

## Cloud Run
- Staging deploys run via `.github/workflows/deploy-staging.yml`, which builds with Cloud Build, pushes to Artifact Registry (`europe-west1-docker.pkg.dev/$GCP_PROJECT_ID/vida/vida:staging`), and deploys the `vida-staging` service to Cloud Run.
- Canonical staging URL: `https://vida-staging-731655778429.europe-west1.run.app` (used by smokes and the frontend default unless `VITE_API_URL` overrides it).
- Fly.io deployments have been retired; any legacy `FLY_*` repository secrets are unused and can be removed during the next credentials hygiene pass.
- The health probe responds with `ok` at `/health`, `/_health`, `/healthz`, and `/healthz/`.

## Accounts Payable adapters
- The adapter registry and Billit implementation are documented in [`docs/ADAPTERS.md`](docs/ADAPTERS.md). Start there before wiring up additional providers.
- Staging stays on the mock adapter by default because `.github/workflows/deploy-staging.yml` hardcodes `VIDA_AP_ADAPTER=mock`. Override that value only after the Billit secrets are populated.
- To enable Billit in another environment, set `VIDA_AP_ADAPTER=billit` alongside `AP_BASE_URL` and either `AP_API_KEY` or `AP_CLIENT_ID`/`AP_CLIENT_SECRET`.
- Provision empty GitHub Actions secrets for both staging and production environments so credentials can be added later: `AP_BASE_URL`, `AP_CLIENT_ID`, `AP_CLIENT_SECRET`, `AP_API_KEY`.
- Webhook callbacks continue to use `AP_WEBHOOK_SECRET` — see the adapters doc for details on `/ap/status-webhook`.

### Billit sandbox setup (checklist)
- In GitHub → *Settings → Secrets and variables → Actions*, add repository secrets for `AP_BASE_URL` plus either `AP_API_KEY` or both `AP_CLIENT_ID` / `AP_CLIENT_SECRET` (leave values blank until you receive sandbox credentials).
- Keep `VIDA_AP_ADAPTER=mock` in staging. For a one-off Billit validation run, dispatch the `Smoke AP Billit` workflow from the Actions tab — it temporarily sets `VIDA_AP_ADAPTER=billit` for that smoke only.
- Once credentials are in place, rerun the smoke to confirm connectivity before considering a staging deploy override.

## API
Generate an invoice directly through `/api/invoice` (see [openapi.js](openapi.js) for the payload schema):

```bash
curl -sS http://localhost:3001/api/invoice \
  -H "x-api-key: <api-key>" \
  -H "Content-Type: application/json" \
  --data @order.json > invoice.xml
```

## Quickstart (staging)

Use the [OpenAPI spec](openapi.js) for field details. The sample payload in [`examples/order.sample.json`](examples/order.sample.json) matches the `/api/invoice` schema. Staging runs at **https://vida-staging-731655778429.europe-west1.run.app**.

Example request payload:

```json
{
  "orderNumber": "INV-2025-0001",
  "currency": "EUR",
  "issueDate": "2025-02-01",
  "buyer": {
    "name": "Acme GmbH",
    "endpoint": { "id": "9915:acme", "scheme": "9915" },
    "address": {
      "streetName": "Alexanderplatz 1",
      "cityName": "Berlin",
      "postalZone": "10178",
      "countryCode": "DE"
    }
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
curl -sS https://vida-staging-731655778429.europe-west1.run.app/api/invoice \
  -H "x-api-key: $VIDA_KEY" \
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

- Auth: provide a configured API key via `x-api-key: <value>` (or `Authorization: Bearer <value>` for backwards compatibility). Missing or invalid values return `401`.
- BIS validation errors map to `message` (human readable), `field` (dot-path), and optional `ruleId` returned by the validator.
- Common pitfalls: omit buyer endpoint IDs, send currency codes outside ISO 4217, or forget to align `vatRate` with `buyer` country — the validator will reject those.

## Authentication
All mutating endpoints (`POST /api/invoice`, `POST /webhook/order-created`, etc.) require a valid API key. Configure keys via `VIDA_API_KEYS` (comma-separated) and supply one of them in the `x-api-key` header for every request. For legacy clients, `Authorization: Bearer <key>` is still accepted, but new integrations should move to `x-api-key` exclusively.

## Sending a test invoice (Scrada)
Use the **Send Peppol UBL via Scrada** workflow when you need a verifiable UBL send through Scrada without redeploying:

1. Commit or upload the UBL you want to send (e.g. `peppol/fixtures/invoice_peppol_bis3.xml`).
2. In **GitHub → Actions → Send Peppol UBL via Scrada → Run workflow**, set:
   - `file`: relative path to the XML.
   - `environment`: `apitest` (default) or `prod`.
   - Optional overrides: `senderId`, `receiverId`, `pollMinutes`, `buyerReference`, `orderId`, `extRef`.
3. The workflow resolves blank sender/receiver IDs in this order: workflow input → secret (`SCRADA_SENDER_ID` / `SCRADA_TEST_RECEIVER_ID`) → repo variable (`SCRADA_SENDER_ID` / `SCRADA_TEST_RECEIVER_ID`) → fallback `0208:0755799452` / `9925:BE0749521473`.
4. A guard step prints the effective sender/receiver and fails fast (exit code `2`) if they match, preventing accidental self-sends.
5. The PowerShell sender patches BIS headers, posts to Scrada, and polls for up to `pollMinutes` (default 12 minutes) until Scrada returns `Processed`, `Delivered`, or `Error`. A timeout exits with `124`.
6. Every run prints `DOC: <uuid>` plus `[status=…; attempt=…; err=…]` lines, uploads both the original and patched `.send.xml` as `scrada-ubl-<run-id>`, and writes `Scrada DOC=<uuid> FINAL=<status>` to the run summary for quick reference.
