# Scrada Integration Run

- Run: https://github.com/Global-investment-Consulting/Vida/actions/runs/19030276299 (SHA `1395d9e4e8a99116a32ef123941e0fff49509270`)
- Result: ❌ `400 Bad Request` on JSON path and UBL fallback (see `artifacts/scrada/error-body.txt`)
- Archive: not created (`.data/archive/peppol/<documentId>.xml` absent)
- Attempted VAT variants: `BE0755799452`, `0755799452`, `omit-buyer-vat` (none accepted)
- Header names sent with UBL: `x-scrada-external-reference`, `x-scrada-peppol-c1-country-code`, `x-scrada-peppol-document-type-scheme`, `x-scrada-peppol-document-type-value`, `x-scrada-peppol-process-scheme`, `x-scrada-peppol-process-value`, `x-scrada-peppol-receiver-id`, `x-scrada-peppol-receiver-scheme`, `x-scrada-peppol-sender-id`, `x-scrada-peppol-sender-scheme` (`artifacts/scrada/ubl-header-names.txt`)

## Docs → Code Checklist
| Requirement | Implementation | Status |
| --- | --- | --- |
| JSON payload matches `PeppolOnlyInvoice` (supplier/customer, totals, VAT) | `apps/api/src/scrada/payload.ts:419` | ✅ |
| Customer Peppol ID forced to `0208:${SCRADA_TEST_RECEIVER_ID}` | `apps/api/src/scrada/payload.ts:420` | ✅ |
| UBL send enforces required `x-scrada-*` headers (iso6523 scheme mapping) | `apps/api/src/adapters/scrada.ts:595` | ✅ |
| VAT variant ladder before UBL fallback | `apps/api/src/adapters/scrada.ts:657` | ✅ |
| Rate-limit aware retries | `apps/api/src/lib/http.ts:102` | ✅ |
| Status polling & classification | `apps/api/src/adapters/scrada.ts:780` | ✅ |
| Participant lookup endpoints updated | `apps/api/src/adapters/scrada.ts:453` | ✅ |
| UBL archiving wiring in place | `apps/api/src/adapters/scrada.ts:892` | ⚪ (not exercised; send failed) |

## Key Artefacts
- JSON payload: `artifacts/scrada/json-sent.json`
- UBL payload: `artifacts/scrada/ubl-sent.xml`
- Error log: `artifacts/scrada/error-body.txt` (first entry: `[2025-11-03T09:39:29.553Z] attempt=1 channel=json vatVariant=BE0755799452 status=400 error=[scrada] Failed to send sales invoice JSON (HTTP 400)`)

## Next Steps
1. Ask Scrada support why `POST /peppol/outbound/salesInvoice` and `/peppol/outbound/document` return bare `400` despite doc-compliant payload; provide JSON/UBL/headers from the artifact.
2. Confirm whether the header `x-scrada-peppol-sender-scheme` should be `iso6523-actorid-upis` or a numeric code (current env supplies `0208`).
3. Verify whether Scrada requires additional JSON fields (e.g., book year, journal, payment methods) beyond the published `PeppolOnlyInvoice` schema.
4. Retry once Scrada clarifies the accepted payload/header combination; logs now emit sanitized response headers and axios dump to aid follow-up.
