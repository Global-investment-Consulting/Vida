# Status Report — 2025-10-30

## Pull Requests
- #122 — chore/toolchain-pin: pinned Node 20.19.0 with toolchain verification; `.nvmrc` and `.npmrc` now live on `main`. Tests deferred to CI (auto-merge on green).
- #123 — ci/staging-adapter-switch: staging adapter now env-driven via `vars.STAGING_AP_ADAPTER` (defaults to `mock`); Billit smokes gated on secrets and adapter selection. Tests deferred to CI (auto-merge on green).
- #124 — feat/banqup-stub: introduced `src/apadapters/banqup.ts`, shared contracts in `src/apadapters/contracts.ts`, and coverage tests. Local `npm run test` failed in this environment (Windows npm cannot execute from UNC path); CI will verify.
- #125 — feat/ops-view: added Ops dashboard tab with DLQ list + metrics snapshot alongside async metrics handling. Local vitest execution blocked by UNC path; CI is responsible for validation.

## Notes
- Local `npm` commands fail on this workstation because Windows cannot execute `vitest` from the `\\wsl.localhost` UNC path. CI pipelines must run the test matrix.
- `dlq:list` and `dlq:retry` helper scripts were added for operational use; retry endpoint remains a placeholder pending implementation.
