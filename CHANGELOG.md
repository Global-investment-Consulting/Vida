# Changelog

## Unreleased

- _No unreleased changes._

## v0.1.0 - 2025-10-22

- Standardized staging on Google Cloud Run, decommissioned Fly.io assets, and pointed all smokes at the canonical `vida-staging-731655778429.europe-west1.run.app`.
- Expanded `/docs` coverage (including `docs/ADAPTERS.md`) and README guidance for adapter onboarding and deployment hygiene.
- Enforced idempotent invoice creation with replay-safe smokes (`Idempotency Probe`) to verify duplicate webhook handling.
- Hardened API rate limiting for key-protected endpoints and clarified configuration defaults.
- Ensured EN16931-compliant VAT calculations remain deterministic across generated UBL payloads.
- Surfaced operational metrics (`/metrics`) for AP send attempts, successes/failures, and webhook latency histograms.
- Shipped the AP mock adapter as the default staging integration with Billit-ready configuration toggles.
- Secured `/ap/status-webhook` with signed payload validation plus replay protection, mirrored in smoke automation.
- Added GitHub smoke workflows (`smoke-staging`, `smoke-ap-webhook`, optional `smoke-ap-billit`) to guard critical flows end-to-end.
