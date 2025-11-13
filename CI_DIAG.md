# CI Diagnostics – PR #135 (feature/scrada-peppol-sender)

## A. Commit & Branch
- Branch: `pr-135` (tracks `feature/scrada-peppol-sender`)
- HEAD: `ac02526a6f9cfa7adbc44137d0c9aaaf2e724094`
- Title: `feat(peppol): scrada sender tooling`
- Author: Codex Agent <codex-agent@example.com> @ 2025-11-08 20:19:23 +0100

## B. Workflow Inventory
```
alert-on-dlq.yml
alert-on-smoke-failure.yml
bootstrap-meta.yml
ci.yml
deploy-staging.yml
deploy-staging.yml.bak
deploy-staging.yml.bak2
deploy-staging.yml.bak3
deploy-staging.yml.bak_agents
deploy-staging.yml.bak_verify
idempotency-probe.yml
manual-deploy-staging.yml
scrada-integration.yml
send-peppol.yml
smoke-ap-billit-sandbox-live.yml
smoke-ap-billit-sandbox.yml
smoke-ap-billit.yml
smoke-ap-webhook.yml
smoke-staging.yml
```

## C. Local Lint/Test Summary (Node 20.19.0 / npm 10.8.2)
| Command | Result | Notes |
| --- | --- | --- |
| `npm ci` | ✅ | Clean install after `nvm use 20.19.0`. |
| `npm run -s lint` | ✅ | ESLint exit code 0. |
| `npm test -- --run` | ✅ | Vitest: 27 files / 83 tests passed, 3 skipped. |

## D. Failed Actions Summary
| Workflow | Job | Runner | Status | One-line error |
| --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` ([run 19197483721](https://github.com/Global-investment-Consulting/Vida/actions/runs/19197483721)) | *No jobs scheduled* | ubuntu-latest (intended) | ❌ workflow rejected | Workflow references `${{ env.VIDA_AP_ADAPTER }}` inside job-level `if` statements, which GitHub forbids, so validation failed before job creation. |
| `.github/workflows/bootstrap-meta.yml` ([run 19197483642](https://github.com/Global-investment-Consulting/Vida/actions/runs/19197483642)) | *No jobs scheduled* | ubuntu-latest (intended) | ❌ workflow rejected | Job-level `if` calls `hashFiles('.github/BOOTSTRAPPED')`, which is unavailable outside step contexts; run stopped during validation. |

## E. Failure Log Tails
### CI workflow – run 19197483721
```
$ gh run view 19197483721 --log
failed to get run log: log not found

$ actionlint
.github/workflows/ci.yml:93:13: context "env" is not allowed here. available contexts are "github", "inputs", "needs", "vars". [expression]
   |
93 |     if: ${{ env.VIDA_AP_ADAPTER != 'scrada' }}
   |             ^~~~~~~~~~~~~~~~~~~
.github/workflows/ci.yml:117:60: context "env" is not allowed here. available contexts are "github", "inputs", "needs", "vars". [expression]
    |
117 |     if: ${{ needs.billit-gate.outputs.enabled == 'true' && env.VIDA_AP_ADAPTER != 'scrada' }}
    |                                                           ^~~~~~~~~~~~~~~~~~~
```

### Bootstrap Meta workflow – run 19197483642
```
$ gh run view 19197483642 --log
failed to get run log: log not found

$ actionlint
.github/workflows/bootstrap-meta.yml:17:96: calling function "hashFiles" is not allowed here. "hashFiles" is only available in jobs.<job_id>.steps.* contexts. [expression]
   |
17 |     if: ${{ github.event_name == 'workflow_dispatch' && github.event.inputs.force == 'true' || hashFiles('.github/BOOTSTRAPPED') == '' }}
   |                                                                                               ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

## F. Root-Cause Hypothesis
- Both failed runs were rejected during YAML validation because the workflows use unsupported expressions (job-level `${{ env.* }}` checks and `hashFiles()` outside step scope). As a result GitHub never provisioned runners or produced logs.

## G. Proposed Fix Plan
1. `.github/workflows/ci.yml` (lines ~90-120): replace job-level `if` conditions that reference `env.VIDA_AP_ADAPTER` with permitted contexts (e.g., recompute `contains(github.ref, '/scrada')` inline or emit a job output) before gating the Billit jobs.
2. `.github/workflows/bootstrap-meta.yml` (line 17): move the sentinel `hashFiles('.github/BOOTSTRAPPED')` check into a step (bash or `actions/github-script`) that sets an output, and gate subsequent steps/jobs using that output so `hashFiles()` stays within allowed step contexts.
