# Vida GitHub Audit (Read-Only)

## Auth
- gh auth status logged in as Samcogtz; scopes: gist, read:org, repo, workflow.

## Repository Metadata
- Name: Global-investment-Consulting/Vida (private).
- Default branch: main; legacy master still exists.
- Created: 2025-10-13; updated: 2025-10-30; last push: 2025-10-30.
- Languages (bytes): JavaScript 276k, TypeScript 256k, Shell/PowerShell/HTML/CSS/Python/Dockerfile follow.
- Size: 1.4 MB; forks: 0; watchers: 0; open issues (API): 16.

## Branches (56 total)
- Sample heads: main, master, chore/billit-finalize-e2e, chore/billit-autorepair-404, chore/staging-harden-billit-harness-agents-flags, fix/mvp-tests-auth, chore/ci-hardening, feat/a1-json-to-ubl, feat/ops-view, docs/status-update.

## Tags (17 total)
- Latest: vida-mvp-v0.6.0, v0.6.0, v0.4.1, v0.4.0, v0.3.10-lineendings, v0.3.9, v0.3.8-stable, v0.3.7-tests-pass.

## Pull Requests (103 total; 6 open, 97 merged, 0 closed)
- Open PRs:
  - #117 Billit finalize: v1 JSON + registration fallback + smoke parity [head: chore/billit-finalize-e2e → base: main] (created 2025-10-27T20:28:57Z)
  - #101 Autorepair Billit 404: v1 JSON send + registration fallback [head: chore/billit-autorepair-404 → base: main] (created 2025-10-27T17:12:42Z)
  - #92 Staging hardening + Billit harness + Agents flags (Phase 2) [head: chore/staging-harden-billit-harness-agents-flags → base: main] (created 2025-10-26T21:52:58Z)
  - #64 fix: tests+coverage, JWT claim [head: fix/mvp-tests-auth → base: main] (created 2025-10-20T12:34:13Z)
  - #14 chore(ci): add pinned pnpm CI and badge [head: chore/ci-hardening → base: main] (created 2025-10-15T16:35:06Z)
  - #13 Feat/a1 json to ubl [head: feat/a1-json-to-ubl → base: main] (created 2025-10-15T10:05:29Z)
- Recent merges:
  - #126 docs: update status tracking (merged 2025-10-30T14:34:58Z)
  - #125 feat: add ops dashboard view (merged 2025-10-30T14:34:38Z)
  - #124 feat: add Banqup adapter stub (merged 2025-10-30T13:37:50Z)
  - #123 ci: gate Billit smokes behind staging adapter (merged 2025-10-30T13:37:31Z)
  - #122 chore: pin Node toolchain (merged 2025-10-30T13:37:13Z)

## Issues (open selection)
- #127 ⚠️ DLQ or AP send failures detected (created 2025-10-30T14:44:13Z)
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
- Smoke AP Billit (Sandbox — LIVE call) (path: .github/workflows/smoke-ap-billit-sandbox-live.yml, state: active)
- Smoke AP Billit (Sandbox) (path: .github/workflows/smoke-ap-billit-sandbox.yml, state: active)
- Smoke AP Billit (path: .github/workflows/smoke-ap-billit.yml, state: active)
- Staging AP Webhook Smoke (path: .github/workflows/smoke-ap-webhook.yml, state: active)
- Staging Smoke Test (path: .github/workflows/smoke-staging.yml, state: active)

## Recent Workflow Runs (last 10)
- #18944548888 Alert on DLQ Activity [schedule] status=completed conclusion=failure created=2025-10-30T14:42:37Z
- #18944343153 Deploy staging [workflow_run] status=completed conclusion=success created=2025-10-30T14:36:03Z
- #18944335758 Deploy staging [workflow_run] status=completed conclusion=cancelled created=2025-10-30T14:35:49Z
- #18944309886 docs: update status tracking (#126) [push] status=completed conclusion=success created=2025-10-30T14:35:00Z
- #18944300886 feat: add ops dashboard view (#125) [push] status=completed conclusion=success created=2025-10-30T14:34:40Z
- #18943735845 Deploy staging [workflow_run] status=completed conclusion=success created=2025-10-30T14:16:34Z
- #18943698738 docs: refresh github audit artifacts [push] status=completed conclusion=success created=2025-10-30T14:15:24Z
- #18943600345 Alert on DLQ Activity [schedule] status=completed conclusion=success created=2025-10-30T14:12:16Z
- #18942891669 Deploy staging [workflow_run] status=completed conclusion=skipped created=2025-10-30T13:49:24Z
- #18942889836 Deploy staging [workflow_run] status=completed conclusion=skipped created=2025-10-30T13:49:21Z

## Key File Presence (ref=main)
| Path | Status | Notes |
| --- | --- | --- |
| .nvmrc | Present | Node 20 toolchain pin (#122) |
| .npmrc | Present | npm config pinned with toolchain |
| docs/openapi.yaml | Present | Retrieved raw spec |
| src/apadapters/banqup.ts | Present | Banqup stub added in PR #124 |
| src/apadapters/contracts.ts | Present | Shared adapter contracts |
| src/validation/ubl.ts | Present | Validator entrypoint |
| dashboard/src/App.jsx | Present | Ops view + dashboard shell |
| src/server.ts | Present | Express entrypoint |
| .github/workflows/deploy-staging.yml | Present | Uses ${{ vars.STAGING_AP_ADAPTER || 'mock' }} |

## OpenAPI Paths (docs/openapi.yaml)
- Count: 8
- Paths: /webhook/order-created,/api/invoice,/invoice/{invoiceId},/invoice/{invoiceId}/status,/ap/status-webhook,/history,/_health,/metrics

## Routes Quick Scan
- src/server.ts: 128:app.get(["/docs", "/docs/"], (_req, res, next) => {;136:app.get("/docs/openapi.yaml", (_req, res, next) => {;145:app.get("/docs/postman_collection.json", (_req, res, next) => {;154:app.get(["/health", "/_health", "/healthz", "/healthz/"], (_req, res) => {;158:app.get("/_version", (_req, res) => {;166:app.get("/", (_req, res) => {;176:app.post("/api/invoice", requireApiKey, async (req: Request, res: Response) => {;266:app.post(;468:app.post("/ap/status-webhook", requireApiKey, async (req: Request, res: Response) => {;596:app.get("/invoice/:invoiceId/status", requireApiKey, async (req: Request, res: Response) => {;651:app.get("/invoice/:invoiceId", requireApiKey, async (req: Request, res: Response) => {;676:app.get("/history", requireApiKey, async (req: Request, res: Response) => {;693:app.get("/ops/dlq", requireApiKey, async (req: Request, res: Response) => {;718:app.post("/ops/dlq/:id/retry", requireApiKey, async (req: Request, res: Response) => {;727:app.get("/metrics", async (_req, res: Response) => {
- src/routes.js: 35:router.get('/invoices', async (req, res) => {;50:router.post('/invoices', async (req, res) => {;106:router.get('/invoices/:id', async (req, res) => {;121:router.get('/invoices/:id/xml', async (req, res) => {
- src/routes_v1.js: 17:router.post('/invoices', idemMw('create'), async (req, res) => {;23:router.get('/invoices/:id', async (req, res) => {;30:router.get('/invoices', async (req, res) => {;37:router.get('/invoices/:id/xml', async (req, res) => {;48:router.get('/invoices/:id/pdf', async (req, res) => {;59:router.post('/invoices/:id/pay', idemMw('pay'), async (req, res) => {;66:router.get('/invoices/:id/payments', async (req, res) => {

## Drift Summary
- Alert on DLQ Activity run #18944548888 failed at step “Check DLQ metrics” (curl debounce found DLQ entries despite zeros); issue #127 auto-opened for follow-up.
- Deploy staging workflow exports STAGING_AP_ADAPTER/VIDA_AP_ADAPTER via ${{ vars.STAGING_AP_ADAPTER || 'mock' }}; no hardcoded adapter overrides detected.
- Open backlog: 6 long-lived PRs (#117/#101/#92/#64/#14/#13) and 10 open issues (including new DLQ alert).
- Key files validated present; /metrics and /history routes confirmed in server.
