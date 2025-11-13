# ViDA Copilot Instructions

## Architecture Overview

**ViDA** is an e-invoicing platform that converts JSON orders to UBL/PEPPOL BIS 3.0 invoices and delivers them through Access Point (AP) adapters. The codebase is organized into:

- **Core API** (`src/`) – TypeScript Express server handling invoice generation, webhook ingestion, and AP delivery
- **Scrada Integration** (`apps/api/`) – Specialized adapter for Scrada PEPPOL network with polling, status webhooks, and UBL/JSON fallback
- **Legacy** (`legacy/`) – Archived JavaScript implementation; not loaded at runtime

## Critical Data Flows

### Invoice Creation Pipeline
1. **Ingestion**: `/webhook/order-created` accepts Shopify/WooCommerce/generic orders via `src/connectors/`
2. **Normalization**: Connectors transform platform payloads to `OrderT` schema (`src/schemas/order.ts`)
3. **UBL Generation**: `src/peppol/convert.ts` produces BIS 3.0-compliant XML with computed VAT totals
4. **Validation**: Optional BIS rule check via `src/validation/ubl.js` (enabled with `VIDA_VALIDATE_UBL=true`)
5. **AP Delivery**: When `VIDA_AP_SEND_ON_CREATE=true`, `src/services/apDelivery.ts` sends UBL through the active adapter with retry logic
6. **Persistence**: History logged to file or Prisma backend via `src/storage/` bundle

### Storage Backend Switching
- **File backend** (default): JSONL files in `./data` – zero setup, used in staging
- **Prisma backend**: Set `VIDA_STORAGE_BACKEND=prisma` + `DATABASE_URL`. Run `npm run prisma:generate && npm run prisma:migrate` before starting
- Storage interface (`src/storage/types.ts`) is backend-agnostic; switch by toggling env var

### AP Adapter Registry
Adapters (`src/apadapters/`) implement `ApAdapter` interface with `send()` and `getStatus()`. Registry in `index.ts` maps adapter names (from `VIDA_AP_ADAPTER` env var) to implementations:
- **mock**: No-op for local dev/CI
- **scrada**: Production Scrada integration (in `apps/api/`)
- **banqup**: Stub placeholder

Scrada adapter uses JSON-first send with UBL fallback on HTTP 400. Polls status via `getStatus()` and accepts async webhook updates at `/ap/status-webhook` with HMAC signature verification.

## Development Workflows

### Local Development
```bash
npm run dev              # Watch mode with tsx
npm run build            # Compile to dist/
npm start                # Run compiled server
npm test                 # Vitest (file backend by default)
DATABASE_URL=file:./dev.db VIDA_STORAGE_BACKEND=prisma npm test  # Prisma backend
```

### CI/Testing Patterns
- **Parallel backends**: `.github/workflows/ci.yml` runs `ci-file` and `ci-prisma` jobs independently
- **Scrada branches**: Optional jobs (Billit contract, Prisma suite) skipped when branch name contains "scrada"
- **Test isolation**: Vitest uses `vmThreads` pool; Prisma backend forces `maxConcurrency=1` to avoid SQLite locks
- **Mock mode**: Tests mock AP adapters; enable live Scrada tests with `SCRADA_RUN_E2E=true`

### Staging Deployment (Cloud Run)
- Triggered by `.github/workflows/deploy-staging.yml` on main branch CI success or manual dispatch
- Cloud Build → Artifact Registry → Cloud Run service at `https://vida-staging-731655778429.europe-west1.run.app`
- Adapter controlled via `VIDA_AP_ADAPTER` (default: `scrada`); override with workflow input
- Health endpoint: `/healthz` returns `ok` for probes

### Sending Test Invoices
Use **Send Peppol UBL via Scrada** workflow (`.github/workflows/send-peppol.yml`):
1. Commit UBL XML to `peppol/fixtures/`
2. Dispatch workflow with `file` path, `environment` (apitest/prod), optional sender/receiver overrides
3. Workflow patches BIS headers, sends via Scrada, polls up to 12 minutes for final status
4. Outputs `DOC: <uuid>` and `FINAL: <status>` to run summary; uploads original + patched XML as artifacts

## Code Conventions

### TypeScript Patterns
- **ES Modules**: `"type": "module"` in package.json; use `.js` extensions in imports (`import { foo } from "./bar.js"`)
- **Type-only imports**: Enforce `@typescript-eslint/consistent-type-imports` – use `import type { ... }` for types
- **Schema-first validation**: Zod schemas in `src/schemas/` define canonical types; extract with `z.infer<typeof Schema>`
- **No floating promises**: ESLint rule enforces `await` or `.catch()` on all promises

### Error Handling
- **HttpError class**: Custom error with `status` property for Express middleware (`throw new HttpError(message, 422)`)
- **Zod validation**: Catch `ZodError` in routes, map first issue to `{ code, message, field }` response
- **BIS validation errors**: UBL validator returns `{ ok, errors: [{ path, msg, ruleId }] }`; send first error as 422

### Configuration Resolution
All config lives in `src/config.ts` with typed getters:
- Boolean flags: `normalizeBoolean()` accepts `1|true|yes` (case-insensitive)
- CSV lists: `normalizeCsv()` splits on commas, trims, filters blanks
- Directories: `resolveDir()` falls back to `./data/<subdir>` when env var unset
- **Adapter selection**: `resolveApAdapterName()` checks `STAGING_AP_ADAPTER` → `VIDA_AP_ADAPTER` → `mock` (staging override takes precedence)

### Metrics & Observability
Prometheus counters/histograms in `src/metrics.ts`:
- `incrementInvoicesCreated()` – UBL generated count
- `incrementApSendSuccess()` / `incrementApSendFail()` – AP delivery outcomes
- `observeApWebhookLatency()` – webhook processing time
- Endpoint: `GET /metrics` returns Prometheus text format

### Authentication
All mutating endpoints (`POST /api/invoice`, `POST /webhook/order-created`, `POST /ap/status-webhook`) require API key via:
- Header: `x-api-key: <key>` (preferred) or `Authorization: Bearer <key>` (legacy)
- Middleware: `src/mw_auth.ts` validates against `VIDA_API_KEYS` CSV list
- Rate limiting: `src/middleware/rateLimiter.ts` applies per-key token bucket (60 req/min default)

### Idempotency
`/webhook/order-created` supports idempotency keys:
- Header: `Idempotency-Key` or `X-Idempotency-Key`
- Cache: `src/services/idempotencyCache.ts` stores `{ invoiceId, invoicePath }` per `(apiKey, idempotencyKey)` tuple
- Response: `X-Idempotency-Cache: HIT|MISS` header indicates cache status
- Bypass history logging on cache hits to avoid duplicates

## Key Files Reference

- **Entry point**: `src/server.ts` – Express app setup, all routes, graceful shutdown
- **Order schema**: `src/schemas/order.ts` – canonical `OrderT` with Zod validation, VAT_RATES constant
- **UBL converter**: `src/peppol/convert.ts` – computes line totals, VAT summaries, builds BIS 3.0 XML
- **Connector registry**: `src/connectors/shopify.ts`, `woocommerce.ts` – platform-specific mappers
- **AP delivery**: `src/services/apDelivery.ts` – `sendWithRetry()` orchestrates adapter calls, retry logic, DLQ writes
- **Storage bundle**: `src/storage/index.ts` – `getStorage()` returns file or Prisma backend via `VIDA_STORAGE_BACKEND`
- **Scrada adapter**: `apps/api/src/adapters/scrada.ts` – `sendInvoiceWithFallback()` with JSON→UBL cascade, polling logic

## Common Pitfalls

- **Import extensions**: Always use `.js` in TS imports, even when file is `.ts` (ESM/NodeNext module resolution)
- **Prisma concurrency**: SQLite requires `maxConcurrency=1` in Vitest config when testing Prisma backend
- **Legacy imports**: Never import from `legacy/` – it's archived and not in TS build
- **Storage reset**: Call `resetStorage()` from `src/storage/index.ts` in test teardown to clear Prisma client and cache
- **Adapter name casing**: Adapter names normalized to lowercase; use `scrada`, `mock`, `banqup` (not `Scrada`)
- **BIS validation**: UBL validator is JavaScript (`.js` extension); returns untyped errors – guard with type checks

## Testing Checklist

When adding features:
1. **Unit test** schema/converter logic in `tests/` with Vitest
2. **Integration test** full endpoint flow (order → UBL → AP send) with mocked adapters
3. **Backend parity**: Verify behavior works with both file and Prisma storage (CI runs both)
4. **Smoke test**: Add scenario to `.github/workflows/smoke-staging.yml` for live validation
5. **Contract test**: For AP adapters, add gated test like `tests/apadapters/billit.contract.test.ts` (runs only when secrets present)

## Debugging Tips

- **Enable Prisma logs**: `DEBUG_STORAGE_PRISMA=1` prints reset cleanup errors
- **Trace AP calls**: Check `src/services/apDelivery.ts` retry loop; logs include `[apDelivery]` prefix
- **Webhook signature**: `/ap/status-webhook` verifies HMAC; test with `scripts/` utilities for local signatures
- **History queries**: Use `npm run history:list` or `GET /history?tenant=<id>` to inspect webhook ingestion
- **DLQ inspection**: `npm run dlq:list` or `GET /ops/dlq` shows failed deliveries (Prisma backend required)
