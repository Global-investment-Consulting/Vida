# Billit vs Scrada Inventory

## Billit Assets
| Path | Role | Suggested action |
| --- | --- | --- |
| MILESTONES_GITHUB.md | Milestone log referencing Billit gating history | can-remove |
| PROJECT_PLAN.md | Project plan bullet describing Billit staging adapter switch | can-remove |
| CHANGELOG.md | Release notes mentioning Billit-ready toggles | can-remove |
| REPORT.md | Initiative report referencing Billit smoke gating | can-remove |
| scripts/billit_send_smoke.mjs | Legacy sandbox sender script for Billit smokes | can-remove |
| tests/config/ap-adapter-name.test.ts | Adapter selection test covering VIDA_AP_ADAPTER=billit | feature-flag only |
| tests/apadapters/billit.contract.test.ts | Billit contract test asserting request shape | feature-flag only |
| tests/apadapters/billit.test.ts | Billit adapter unit tests | feature-flag only |
| CI_DIAG.md | CI diagnostics mentioning Billit workflow failures | can-remove |
| tests/fixtures/billit_invoice_minimal.json | Fixture payload for Billit tests | feature-flag only |
| README.md | Env documentation for enabling the Billit adapter | feature-flag only |
| src/apadapters/index.ts | Registers the Billit adapter | feature-flag only |
| src/apadapters/billit.ts | Billit adapter implementation | feature-flag only |
| REPORT_GITHUB.md | Ops report listing Billit branches/workflows | can-remove |
| src/apadapters/contracts.ts | Adapter metadata declaring Billit info | feature-flag only |
| .github/workflows/scrada-integration.yml | Isolation check ensuring no BILLIT_* vars leak | must-keep |
| .github/workflows/smoke-ap-billit-sandbox.yml | Scheduled/manual Billit sandbox smoke (dry-run) | can-remove |
| .github/workflows/smoke-ap-billit.yml | Manual Billit smoke ping | can-remove |
| .github/workflows/ci.yml | CI workflow with gated Billit contract job | feature-flag only |
| .github/workflows/smoke-ap-billit-sandbox-live.yml | Manual Billit sandbox live-send | can-remove |
| reports/ci-latest.log | Captured CI log referencing Billit harness | can-remove |
| reports/deploy-staging-latest.log | Deploy log mentioning Billit harness | can-remove |
| docs/ADAPTERS.md | Adapter documentation section for Billit setup | feature-flag only |

## Scrada Assets
| Path | Role |
| --- | --- |
| output/api-test-final.bat | Windows batch helper to post BIS 3.0 payloads to Scrada |
| output/scrada_final_report.md | Recorded Scrada integration run report |
| output/scrada_result.md | Scrada run summary capturing payload checks |
| CI_DIAG.md | CI diagnostics doc referencing Scrada workflow state |
| package.json | Root npm scripts including `scrada:send` |
| tools/scrada-peppol/README.md | Documentation for the Scrada PowerShell sender |
| tools/scrada-peppol/Send-PeppolUbl.ps1 | PowerShell script that patches and sends UBLs |
| tools/scrada-peppol/.env.example | Sample environment variables for the sender |
| .github/workflows/scrada-integration.yml | Scrada-focused workflow (tests + smoke send) |
| .github/workflows/send-peppol.yml | Manual Windows workflow invoking the sender |
| .github/workflows/ci.yml | CI pipeline detecting `/scrada` branches |
| docs/adr/0001-scrada-peppol-integration.md | ADR covering Scrada integration |
| apps/api/package.json | Package scripts for Scrada helper service |
| docs/scrada_audit.md | Scrada compliance/audit checklist |
| apps/api/src/types/scrada.ts | Type definitions for Scrada entities |
| apps/api/src/lib/http.ts | Axios client with Scrada headers/retries |
| apps/api/tests/scrada.integration.test.ts | Env-gated Scrada sandbox integration test |
| apps/api/scripts/scrada-send.mjs | CLI driving sendInvoiceWithFallback |
| apps/api/scripts/scrada-status.mjs | CLI polling Scrada document status |
| apps/api/tests/scrada.payload.test.ts | Vitest coverage for payload builders |
| apps/api/src/scrada/payload.ts | JSON + BIS 3.0 payload construction |
| apps/api/scripts/scrada-wait-participant.mjs | Participant lookup polling CLI |
| apps/api/tests/adapters/scrada.adapter.test.ts | Adapter unit tests |
| apps/api/src/adapters/scrada.ts | Main Scrada adapter implementation |

## Workflow Triggers
- **Billit smokes**: `smoke-ap-billit.yml` (workflow_dispatch), `smoke-ap-billit-sandbox.yml` (workflow_dispatch + `cron: 13 2 * * *`), `smoke-ap-billit-sandbox-live.yml` (workflow_dispatch with confirmation).
- **Billit contract**: `ci.yml` (push, pull_request, workflow_dispatch) runs a gated Billit contract test when `plan` job outputs allow it.
- **Scrada isolation**: `scrada-integration.yml` runs on push to `main`, `feat/scrada-e2e-clean`, `feat/scrada-final-bis3`, plus workflow_dispatch (with optional `run_ref` input).
- **Scrada PowerShell sender**: `send-peppol.yml` is workflow_dispatch-only on `windows-latest`.
- **CI branch detector**: `ci.yml` `plan` job inspects refs containing `/scrada` to disable optional non-Scrada jobs.

## Environment Variables & Secrets
- **Billit env/secrets**: `VIDA_AP_ADAPTER`, `STAGING_AP_ADAPTER`, `BILLIT_SANDBOX`, `AP_BASE_URL`, `AP_API_KEY`, `AP_CLIENT_ID`, `AP_CLIENT_SECRET`, `AP_REGISTRATION_ID`, `BILLIT_REGISTRATION_ID`, `BILLIT_RX_SCHEME`, `BILLIT_RX_VALUE`, `BILLIT_DOC_TYPE`, `BILLIT_TRANSPORT_TYPE`, plus workflow vars like `BILLIT_VAT_RATE` and `BILLIT_SELLER_VAT`.
- **Scrada env/secrets**: `SCRADA_API_KEY`, `SCRADA_API_PASSWORD`, `SCRADA_COMPANY_ID`, `SCRADA_WEBHOOK_SECRET`, `SCRADA_API_BASE`, `SCRADA_LANGUAGE`, `SCRADA_SUPPLIER_SCHEME`, `SCRADA_SUPPLIER_ID`, `SCRADA_SUPPLIER_VAT`, `SCRADA_PEPPOL_SENDER_ID`, `SCRADA_PEPPOL_RECEIVER_ID`, `SCRADA_SKIP_PARTICIPANT_PREFLIGHT`, along with optional gates such as `SCRADA_HEADER_SWEEP` or `SCRADA_RUN_E2E`.
