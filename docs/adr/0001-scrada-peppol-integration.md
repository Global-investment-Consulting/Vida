# ADR 0001: Scrada Peppol Integration

- Status: Accepted
- Date: 2025-11-08

## Problem
We need a reliable, repeatable way to send BIS 3.0 compliant UBL invoices through Scrada so that:
- Local developers can dry-run real submissions while patching headers exactly like the already proven "Processed" payload.
- Release managers can manually trigger a Scrada send from GitHub Actions without redeploying application code.
- Credentials stay out of source control while still being easy to configure for test (apitest) and production.

## Decision
- Add a checked-in PowerShell 5+ script (`tools/scrada-peppol/Send-PeppolUbl.ps1`) that patches a UBL invoice, posts it to Scrada, and polls until it reaches `Delivered`, `Processed`, or `Error`.
- Keep configuration purely parameter/env driven so the same entry point can run locally (`pwsh`) and in CI (Windows runner).
- Provide documentation (`tools/scrada-peppol/README.md`) and a `.env.example` to clarify required identifiers.
- Create a manual GitHub Actions workflow (`.github/workflows/send-peppol.yml`) that shells into the PowerShell sender using repository secrets so operators can submit invoices without local access.

## Alternatives Considered
1. **Extend existing Node/TypeScript tooling** – rejected to avoid duplicating the header patching logic already maintained in PowerShell and to stay close to the known-good script provided by Scrada.
2. **Automate via existing deployment workflows** – rejected because we only need an on-demand sender, not a full deployment; coupling would increase blast radius.
3. **Containerize the sender** – rejected for now; PowerShell runs directly on Windows runners, keeping the dependency chain minimal.

## Credentials Handling
- Local development loads environment variables from the shell or a developer-managed `.env` file that mirrors `tools/scrada-peppol/.env.example` (the real file must never be committed).
- GitHub Actions fetches the same values from repository secrets: `SCRADA_COMPANY_ID`, `SCRADA_API_KEY`, `SCRADA_API_PASSWORD`, `SCRADA_PEPPOL_SENDER_ID`, `SCRADA_PEPPOL_RECEIVER_ID`.
- No credentials are stored in the repo; the script validates the presence of required inputs before sending.

## Environments
- **apitest** (`https://apitest.scrada.be`): default environment for dry-runs. The workflow input defaults to `test` which maps to this base URL.
- **prod** (`https://api.scrada.be`): optional workflow input. Requires production-grade credentials but reuses the same script and workflow.

## Risks
- **Credential misconfiguration**: incorrect secret values will cause send failures; mitigated by early validation and README guidance.
- **Windows-specific tooling**: the workflow depends on `pwsh` and Windows curl, so Linux runners cannot reuse it without adjustments.
- **Scrada availability & polling**: the script polls for up to five minutes; longer delays could time out. Operators may need to re-run if Scrada is slow.
- **Schema drift**: if BIS 3.0 header rules change, the script must be updated; placing it in `tools/scrada-peppol/` makes targeted updates easier.
