# Vida Milestone Mapping (PR Evidence)

| Milestone | Status | PR Evidence | Suggested Next Step |
| --- | --- | --- | --- |
| BM1 | 🟢 DONE | PR #122 chore: pin Node toolchain (merged 2025-10-30) | Monitor Node/npm pin as new releases drop. |
| BM2 | 🟢 DONE | PR #123 ci: gate Billit smokes behind staging adapter (merged 2025-10-30) | Keep vars.STAGING_AP_ADAPTER at mock until Billit secrets ready. |
| BM3 | 🟢 DONE | PR #124 feat: add Banqup adapter stub (merged 2025-10-30) | Flesh out Banqup integration once sandbox credentials arrive. |
| BM4 | 🟢 DONE | PR #52 feat(api): POST /api/invoice returns BIS 3.0-valid UBL (merged 2025-10-18) | Continue regression coverage on BIS validation rules. |
| BM5 | 🟢 DONE | PR #125 feat: add ops dashboard view (merged 2025-10-30) | Track DLQ metrics alerts and tune thresholds. |
| FM1 | 🟢 DONE | PR #78 feat: Sprint 1 — docs, idempotency, rate limit, VAT determinism, metrics (merged 2025-10-21) | Revisit foundational docs as new endpoints publish. |
| FM2 | 🟢 DONE | PR #80 feat: Sprint 2 AP adapter integration (merged 2025-10-21) | Harden integration flows with production secrets before enabling. |
| FM3 | 🟢 DONE | PR #125 feat: add ops dashboard view (merged 2025-10-30) | Iterate on DLQ tooling once retry endpoint is implemented. |
| FM4 | 🟢 DONE | PR #126 docs: update status tracking (merged 2025-10-30) | Keep status report in sync with staging configuration changes. |

Notes:
- Labels BM1..BM5 and FM1..FM4 now exist; add them to future PRs to keep audits deterministic.
- Status icons follow repo convention: 🟢 merged, 🟡 open/draft, ⚪ not yet tagged.
