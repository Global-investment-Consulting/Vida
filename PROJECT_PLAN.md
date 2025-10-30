# Project Plan

## Completed (BM series)
- **BM1** — Toolchain pinning (PR #122). Workflow now relies on `.nvmrc` + `.npmrc` and verifies Node/npm versions.
- **BM2** — Staging adapter switch (PR #123). Deploy workflow honours `vars.STAGING_AP_ADAPTER` (default `mock`); Billit smokes run only when env + secrets allow.
- **BM3** — Banqup stub + shared contract (PR #124). Factory extended with selectable Banqup placeholder (`src/apadapters/banqup.ts`) and shared contracts in `src/apadapters/contracts.ts`; contract tests scaffolded (`it.skip`).

## Completed (FM series)
- **FM3** — Ops view (PR #125). Dashboard gains Ops tab with DLQ visibility, metrics snapshot, and CLI helpers.

## Follow-ups
- Implement real DLQ retry execution once integration behaviour is defined.
- Re-run vitest locally once repository can be accessed via a non-UNC path.
