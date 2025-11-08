# Scrada Sandbox Audit

## MUST (Docs alignment)
- Authenticate every request with `X-API-KEY`, `X-PASSWORD`, and optional `Language` (docs Authentication); the request interceptor enforces this and normalises the `/v1` base URL (`apps/api/src/lib/http.ts:182`).
- Call company-scoped endpoints under `/v1/company/{companyID}/…` (Peppol outbound docs); `companyPath` wires every adapter call through the company UUID (`apps/api/src/adapters/scrada.ts:611`).
- JSON send uses `POST /peppol/outbound/salesInvoice` with the `v1.PeppolOnlyInvoice` schema: supplier & customer parties, `totalExclVat/totalVat/totalInclVat`, `vatTotals`, line amounts, and forces `customer.peppolID` resolution (`apps/api/src/scrada/payload.ts:419`).
- Maintain the documented VAT retry ladder (BE… → digits-only → omit) before switching to UBL fallback when Scrada returns 400 (`apps/api/src/adapters/scrada.ts:657`).
- UBL fallback `POST /peppol/outbound/document` attaches all required `x-scrada-peppol-*` headers plus `x-scrada-external-reference`, failing fast if any are missing (`apps/api/src/adapters/scrada.ts:595`).
- Poll document status via `GET /peppol/outbound/document/{documentID}/info` and fetch the delivered UBL through `/ubl`, mapping terminal statuses per docs (`apps/api/src/adapters/scrada.ts:404`, `apps/api/src/adapters/scrada.ts:810`).
- Respect rate limiting (60 rpm token bucket) and back-off when `429`/`x-ratelimit-reset` arrive (`apps/api/src/lib/http.ts:79`).
- Support `/peppol/lookup/{scheme}/{id}` and JSON lookup fallback with correct country defaults (`apps/api/src/adapters/scrada.ts:453`).
- Archive delivered UBLs to `.data/archive/peppol/{documentId}.xml` (or the configured bucket) for retention (`apps/api/src/adapters/scrada.ts:892`).

## SHOULD (Docs + integrator hygiene)
- Apply jittered polling/backoff while waiting on Scrada status to stay within rate limits (`apps/api/src/adapters/scrada.ts:794`).
- Preserve buyer reference and payment semantics from JSON into the BIS 3.0 UBL (`apps/api/src/scrada/payload.ts:419`).
- Emit artefacts for JSON, UBL, header-name preview, and error bodies to speed up support escalations (`apps/api/src/adapters/scrada.ts:644`).
- Allow sandbox overrides for customer address/contact metadata while still defaulting to the documented receiver (`apps/api/src/scrada/payload.ts:306`).

## Code Alignment Matrix
| Requirement | Implementation | Status |
| --- | --- | --- |
| JSON payload matches `v1.PeppolOnlyInvoice` (parties, totals, VAT) | `apps/api/src/scrada/payload.ts:419` | ✅ |
| Customer Peppol ID forced to `0208:${SCRADA_TEST_RECEIVER_ID}` | `apps/api/src/scrada/payload.ts:420` | ✅ |
| UBL send enforces eight `x-scrada-*` headers | `apps/api/src/adapters/scrada.ts:595` | ✅ |
| VAT variant retry then UBL fallback | `apps/api/src/adapters/scrada.ts:657` | ✅ |
| Rate-limit aware Axios retry/backoff | `apps/api/src/lib/http.ts:102` | ✅ |
| Status polling + terminal classification | `apps/api/src/adapters/scrada.ts:780` | ✅ |
| Participant lookup uses `/company/{companyID}/peppol/lookup` | `apps/api/src/adapters/scrada.ts:453` | ✅ |
| Archive path `.data/archive/peppol/{documentId}.xml` | `apps/api/src/adapters/scrada.ts:892` | ✅ |
