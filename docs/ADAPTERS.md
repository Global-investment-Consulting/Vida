# Accounts Payable Adapters

ViDA can integrate with different AP (accounts payable) providers through a thin adapter layer located under `src/apadapters`. Each adapter implements the `ApAdapter` interface with two responsibilities:

- `send({ tenant, invoiceId, ublXml, order })` submits the invoice (both the UBL string and the parsed order context) to the provider and returns a provider-specific identifier alongside the initial dispatch status.
- `getStatus(providerId)` polls the provider for delivery updates and maps provider states into ViDA's canonical `queued | sent | delivered | error` lifecycle.

The adapter registry lives in `src/apadapters/index.ts`. To register a new provider, add it to the registry map with a unique key (lower-case) and implement the interface in a new module. Unknown values fall back to the mock adapter, so adding new providers is non-breaking by default.

## Billit adapter

The Billit adapter lives in `src/apadapters/billit.ts` and is intended for production use once credentials are available. It supports two authentication modes:

- API key: set `AP_API_KEY` and the adapter will send the `apiKey` header alongside optional `partyID`/`ContextPartyID` routing headers. No `Authorization` header is used in this mode.
- OAuth2 client credentials: when no API key is present the adapter exchanges `AP_CLIENT_ID` and `AP_CLIENT_SECRET` for an access token using the client-credentials grant at `${AP_BASE_URL}/oauth/token`. Tokens are cached in-process until they expire and the resulting bearer token is sent via the `Authorization` header together with any party headers.

Invoices are POSTed as JSON to `${AP_BASE_URL}/v1/einvoices/registrations/{registrationID}/commands/send`. Delivery status is polled via `${AP_BASE_URL}/v1/einvoices/registrations/{registrationID}/orders/{orderId}` with the same authentication headers. The adapter derives the registration identifier from `AP_REGISTRATION_ID` (or falls back to `AP_PARTY_ID`/`BILLIT_REGISTRATION_ID`).

### Required environment variables

Configure the following variables wherever the adapter will run:

| Variable | Description |
| -------- | ----------- |
| `VIDA_AP_ADAPTER` | Set to `billit` to activate the adapter for that deployment. |
| `AP_PROVIDER` | Optional descriptor (use `billit`); surfaced for observability/tooling. |
| `AP_BASE_URL` | Base URL for the Billit API (e.g. `https://api.billit.be`). |
| `AP_API_KEY` | Bearer token for direct API-key authentication (preferred when available). |
| `AP_CLIENT_ID` / `AP_CLIENT_SECRET` | Client credentials for OAuth2 fallback when no API key is provided. |
| `AP_REGISTRATION_ID` | Required Billit registration identifier (falls back to `BILLIT_REGISTRATION_ID`/`AP_PARTY_ID` when unset). |
| `AP_PARTY_ID` | Optional party header to scope requests to a specific company (also used as the registration id when no explicit `AP_REGISTRATION_ID` is provided). |
| `AP_CONTEXT_PARTY_ID` | Optional accountant/partner identifier forwarded as the `ContextPartyID` header. |
| `AP_TRANSPORT_TYPE` | Preferred Billit transport (defaults to `Peppol`). |

All variables default to empty strings, so missing configuration will surface as runtime errors rather than implicit fallbacks.

## Switching adapters safely

- Staging remains on the `mock` adapter by default. The GitHub Actions workflow (`.github/workflows/deploy-staging.yml`) explicitly sets `VIDA_AP_ADAPTER=mock` and should not be changed unless Billit credentials are fully provisioned for staging.
- To opt into Billit for another environment (including local development), set `VIDA_AP_ADAPTER=billit` and provide the Billit secrets noted above. Leaving `VIDA_AP_ADAPTER` unset keeps the mock adapter active.
- When rotating between adapters, restart the process to ensure cached OAuth tokens are cleared (or invoke `resetBillitAuthCache` in tests).
- The shared Cloud Run staging service lives at `https://vida-staging-731655778429.europe-west1.run.app`; smokes and manual checks should use that URL unless a temporary override is announced.

### Billit sandbox setup (quick checklist)
- Add repository secrets in **GitHub → Settings → Secrets and variables → Actions** for `AP_BASE_URL` plus either `AP_API_KEY` or both `AP_CLIENT_ID` and `AP_CLIENT_SECRET` once credentials are issued.
- Leave staging on `VIDA_AP_ADAPTER=mock`; trigger the `Smoke AP Billit` workflow from the Actions tab when you want to exercise the Billit adapter — the workflow injects `VIDA_AP_ADAPTER=billit` only for that smoke.
- Rerun the smoke after updating credentials to verify authentication before promoting the adapter in any deployment pipeline.

## Status webhooks

Billit (or any AP provider) can send asynchronous delivery updates to ViDA via `POST /ap/status-webhook`. The existing implementation validates a shared secret (`AP_WEBHOOK_SECRET`) and persists statuses via `src/history/invoiceStatus.ts`. When enabling Billit:

- Share the webhook endpoint and secret with the provider.
- Ensure the secret is configured wherever the Billit adapter runs.
- The webhook handler and polling via `getStatus` work together: webhooks push real-time updates, and polling covers any missed events.

Refer to the API documentation for payload format expectations and the webhook signature process. The adapter tests (`tests/apadapters/billit.test.ts`) demonstrate the mocked request flow end-to-end.
