# Vida GitHub Audit (Read-Only)

## Auth
- gh auth status logged in as Samcogtz; scopes: gist, read:org, repo, workflow.

## Repository Metadata
- Name: Global-investment-Consulting/Vida (private).
- Default branch: main; legacy master still exists.
- Created: 2025-10-13; updated: 2025-10-30; last push: 2025-10-30.
- Languages (bytes): JavaScript 258k, TypeScript 247k, Shell/PowerShell/HTML/CSS/Python/Dockerfile follow.
- Size: 1.4 MB; forks: 0; watchers: 0; open issues (API): 17.

## Branches (56 total)
- Sample heads: main, master, feat/ops-view, docs/status-update, chore/toolchain-pin, ci/staging-adapter-switch, feat/banqup-stub, chore/billit-finalize-e2e, fix/mvp-tests-auth, feat/a1-json-to-ubl.
- Automation/legacy branches prefixed with chore/ and ci/; multiple historical feature branches remain open.

## Tags (17 total)
- Latest: vida-mvp-v0.6.0, v0.6.0, v0.4.1, v0.4.0, v0.3.10-lineendings, v0.3.9, v0.3.8-stable, v0.3.7-tests-pass.

## Pull Requests (103 total; 8 open, 95 merged, 0 closed)
- Open PRs:
  - #126 docs: update status tracking [head: docs/status-update → base: main] (created 2025-10-30T12:07:20Z)
  - #125 feat: add ops dashboard view [head: feat/ops-view → base: main] (created 2025-10-30T12:05:22Z)
  - #117 Billit finalize: v1 JSON + registration fallback + smoke parity [head: chore/billit-finalize-e2e → base: main] (created 2025-10-27T20:28:57Z)
  - #101 Autorepair Billit 404: v1 JSON send + registration fallback [head: chore/billit-autorepair-404 → base: main] (created 2025-10-27T17:12:42Z)
  - #92 Staging hardening + Billit harness + Agents flags (Phase 2) [head: chore/staging-harden-billit-harness-agents-flags → base: main] (created 2025-10-26T21:52:58Z)
  - #64 fix: tests+coverage, JWT claim [head: fix/mvp-tests-auth → base: main] (created 2025-10-20T12:34:13Z)
  - #14 chore(ci): add pinned pnpm CI and badge [head: chore/ci-hardening → base: main] (created 2025-10-15T16:35:06Z)
  - #13 Feat/a1 json to ubl [head: feat/a1-json-to-ubl → base: main] (created 2025-10-15T10:05:29Z)
- Recent merges:
  - #124 feat: add Banqup adapter stub (merged 2025-10-30T13:37:50Z)
  - #123 ci: gate Billit smokes behind staging adapter (merged 2025-10-30T13:37:31Z)
  - #122 chore: pin Node toolchain (merged 2025-10-30T13:37:13Z)
  - #121 LIVE smoke: ensure artifact always uploads (post-profile retest) (merged 2025-10-28T21:40:53Z)
  - #120 Wire envs for LIVE Billit smoke (merged 2025-10-28T06:29:15Z)

## Issues (23 total; 9 open, 14 closed)
- Open issues:
  - #98 Post-merge audit: regression for PR #96 (created 2025-10-27T13:09:57Z)
  - #90 Agent Roadmap – Q4 (created 2025-10-24T08:33:36Z)
  - #62 MVP frontend + billing ready (created 2025-10-20T12:00:53Z)
  - #33 Docs & Marketplace presence (created 2025-10-17T07:48:32Z)
  - #32 Dashboard: sent invoices & statuses (created 2025-10-17T07:48:26Z)
  - #24 Billing: Stripe subscriptions (created 2025-10-17T05:56:13Z)
  - #23 Multi-tenant: users/workspaces (created 2025-10-17T05:56:07Z)
  - #9 A3: Local PEPPOL simulation (created 2025-10-15T06:50:38Z)
  - #8 A2: UBL → PEPPOL envelope (created 2025-10-15T06:50:35Z)

## Workflows (11 active)
- Alert on DLQ Activity (path: .github/workflows/alert-on-dlq.yml, state: active)
- Alert on Smoke Failure (path: .github/workflows/alert-on-smoke-failure.yml, state: active)
- CI (path: .github/workflows/ci.yml, state: active)
- Deploy staging (path: .github/workflows/deploy-staging.yml, state: active)
- Idempotency Probe (path: .github/workflows/idempotency-probe.yml, state: active)
- Manual Deploy Staging (path: .github/workflows/manual-deploy-staging.yml, state: active)
- Smoke AP Billit (path: .github/workflows/smoke-ap-billit.yml, state: active)
- Smoke AP Billit (Sandbox — LIVE call) (path: .github/workflows/smoke-ap-billit-sandbox-live.yml, state: active)
- Smoke AP Billit (Sandbox) (path: .github/workflows/smoke-ap-billit-sandbox.yml, state: active)
- Staging AP Webhook Smoke (path: .github/workflows/smoke-ap-webhook.yml, state: active)
- Staging Smoke Test (path: .github/workflows/smoke-staging.yml, state: active)

## Recent Workflow Runs (last 10)
- #18942891669 Deploy staging [workflow_run] status=completed conclusion=skipped created=2025-10-30T13:49:24Z
- #18942889836 Deploy staging [workflow_run] status=completed conclusion=skipped created=2025-10-30T13:49:21Z
- #18942862555 docs: update status tracking [pull_request] status=completed conclusion=success created=2025-10-30T13:48:29Z
- #18942862220 docs: capture latest staging + ops updates [push] status=completed conclusion=success created=2025-10-30T13:48:28Z
- #18942828899 Deploy staging [workflow_run] status=completed conclusion=skipped created=2025-10-30T13:47:23Z
- #18942826728 Deploy staging [workflow_run] status=completed conclusion=skipped created=2025-10-30T13:47:19Z
- #18942800645 feat: add ops dashboard view [pull_request] status=completed conclusion=success created=2025-10-30T13:46:27Z
- #18942800052 fix: await async metrics [push] status=completed conclusion=success created=2025-10-30T13:46:26Z
- #18942788315 Alert on DLQ Activity [schedule] status=completed conclusion=success created=2025-10-30T13:46:05Z
- #18942572933 Deploy staging [workflow_run] status=completed conclusion=success created=2025-10-30T13:38:56Z

## Key File Presence (ref=main)
| Path | Status | Notes |
| --- | --- | --- |
| .nvmrc | Present | main pinned via PR #122 |
| .npmrc | Present | Node/npm toolchain config |
| docs/openapi.yaml | Present | Retrieved raw spec |
| src/apadapters/banqup.ts | Present | Banqup stub added in PR #124 |
| src/apadapters/contracts.ts | Present | Shared adapter contracts |
| src/validation/ubl.ts | Present | Validator entrypoint |
| dashboard/src/App.jsx | Present | Frontend shell |
| src/server.ts | Present | Express entrypoint |
| .github/workflows/deploy-staging.yml | Present | Uses ${{ vars.STAGING_AP_ADAPTER || 'mock' }} |

## OpenAPI Paths (docs/openapi.yaml)
- Count: 8
- Paths: /webhook/order-created,/api/invoice,/invoice/{invoiceId},/invoice/{invoiceId}/status,/ap/status-webhook,/history,/_health,/metrics

## Routes Quick Scan
- src/server.ts: 127:app.get(["/docs", "/docs/"], (_req, res, next) => {;135:app.get("/docs/openapi.yaml", (_req, res, next) => {;144:app.get("/docs/postman_collection.json", (_req, res, next) => {;153:app.get(["/health", "/_health", "/healthz", "/healthz/"], (_req, res) => {;157:app.get("/_version", (_req, res) => {;165:app.get("/", (_req, res) => {;175:app.post("/api/invoice", requireApiKey, async (req: Request, res: Response) => {;265:app.post(;466:app.post("/ap/status-webhook", requireApiKey, async (req: Request, res: Response) => {;594:app.get("/invoice/:invoiceId/status", requireApiKey, async (req: Request, res: Response) => {;649:app.get("/invoice/:invoiceId", requireApiKey, async (req: Request, res: Response) => {;656:  const knownPath = invoiceIndex.get(invoiceIdParam);;674:app.get("/history", requireApiKey, async (req: Request, res: Response) => {;691:app.get("/metrics", (_req, res: Response) => {;
- src/routes.js: 35:router.get('/invoices', async (req, res) => {;50:router.post('/invoices', async (req, res) => {;106:router.get('/invoices/:id', async (req, res) => {;121:router.get('/invoices/:id/xml', async (req, res) => {;
- src/routes_v1.js: 17:router.post('/invoices', idemMw('create'), async (req, res) => {;23:router.get('/invoices/:id', async (req, res) => {;30:router.get('/invoices', async (req, res) => {;37:router.get('/invoices/:id/xml', async (req, res) => {;48:router.get('/invoices/:id/pdf', async (req, res) => {;59:router.post('/invoices/:id/pay', idemMw('pay'), async (req, res) => {;66:router.get('/invoices/:id/payments', async (req, res) => {;

## Drift Summary
- CI: Build & Test matrix currently running for #125/#126; preceding runs succeeded (see list above). Local vitest blocked on missing Node toolchain in this environment.
- Staging adapter: deploy-staging workflow exports STAGING_AP_ADAPTER/VIDA_AP_ADAPTER via ${{ vars.STAGING_AP_ADAPTER || 'mock' }}; repo variable remains mock until credentials arrive.
- Long-lived backlog: PRs #14, #13, #64, #92, #101, #117 remain open; issues #24/#23/#9/#8/#32/#33/#62/#90/#98 still active.
- Operational note: Documentation (REPORT.md / PROJECT_PLAN.md) now highlights the env-driven adapter switch.
