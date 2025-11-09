# Changelog

## Unreleased

- _No unreleased changes._

## v0.1.1 - 2025-10-22

- Fixed the staging Docker build by generating the Prisma client during the builder stage, switching to the Alpine base, and copying Prisma artefacts into the runtime layer so TypeScript compilation succeeds under Cloud Build.
- Ensured Prisma schema, docs, and public assets ship with builds by un-ignoring them in `.dockerignore` and `.gcloudignore`.
- Preserved staging runtime configuration after deploys by propagating adapter, send-on-create, JWT, and PEPPOL settings through the post-deploy `gcloud run services update`.
- Redeployed staging via Cloud Build `9df7ad29-c553-4854-8416-31d9383f94a2` and re-ran `smoke-staging`, `smoke-ap-webhook`, and `idempotency-probe` workflows successfully.

## v0.1.0 - 2025-10-22

- Standardized staging on Google Cloud Run, decommissioned Fly.io assets, and pointed all smokes at the canonical `vida-staging-731655778429.europe-west1.run.app`.
- Expanded `/docs` coverage (including `docs/ADAPTERS.md`) and README guidance for adapter onboarding and deployment hygiene.
- Enforced idempotent invoice creation with replay-safe smokes (`Idempotency Probe`) to verify duplicate webhook handling.
- Hardened API rate limiting for key-protected endpoints and clarified configuration defaults.
- Ensured EN16931-compliant VAT calculations remain deterministic across generated UBL payloads.
- Surfaced operational metrics (`/metrics`) for AP send attempts, successes/failures, and webhook latency histograms.
- Secured `/ap/status-webhook` with signed payload validation plus replay protection, mirrored in smoke automation.
