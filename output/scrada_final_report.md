# Scrada BIS 3.0 Run Report
- Run URL: https://github.com/Global-investment-Consulting/Vida/actions/runs/19137340176  
- Tested SHA: d20f493e404895b7bbb0baaa16ec9e396059944d  
- Adapter check: Adapter=scrada  
- Isolation check: Isolation=OK

## Header Preview
- Content-Type: application/xml; charset=utf-8
- x-scrada-external-reference: VIDA-20251106-111B76
- x-scrada-peppol-c1-country-code: BE
- x-scrada-peppol-document-type-scheme: busdox-docid-qns
- x-scrada-peppol-document-type-value: urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1
- x-scrada-peppol-process-scheme: cenbii-procid-ubl
- x-scrada-peppol-process-value: urn:fdc:peppol.eu:2017:poacc:billing:01:1.0
- x-scrada-peppol-receiver-party-id: iso6523-actorid-upis:0208:0755799452
- x-scrada-peppol-sender-scheme: iso6523-actorid-upis
- x-scrada-peppol-sender-id: 0208:0755799452

## Send Outcome
- Final channel: ubl
- Attempts: JSON → HTTP 400, UBL → HTTP 400
- Document ID: not issued (pipeline stopped on 400)
- Artifacts: artifacts/scrada/json-sent.json; artifacts/scrada/ubl-sent.xml; artifacts/scrada/headers-sent.txt; artifacts/scrada/error-body.txt; artifacts/scrada/scrada-send-output.log; artifacts/scrada/scrada-send-output.json
- Support bundle: output/scrada_support_bundle_19137340176.zip
- Error preview (first lines):
  - [2025-11-06T13:32:15.476Z] attempt=1 channel=json vatVariant=BE0755799452 status=400 error=[scrada] Failed to send sales invoice JSON (HTTP 400)
  - (blank line)

The adapter now emits the BIS 3.0 header set statically and applies the same identifiers in the UBL payload. Remaining HTTP 400 responses should be investigated with the included support bundle.
