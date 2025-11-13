# Summary
- Run URL: https://github.com/Global-investment-Consulting/Vida/actions/runs/19199300477
- SHA: e2199677f6c08c270b5905652e7689244c1d7c2b
- Adapter=scrada
- Isolation: Isolation=OK

## Header values
- Content-Type: application/xml; charset=utf-8
- x-scrada-external-reference: VIDA-20251108-DDAAB4
- x-scrada-peppol-c1-country-code: BE
- x-scrada-peppol-document-type-scheme: busdox-docid-qns
- x-scrada-peppol-document-type-value: urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1
- x-scrada-peppol-process-scheme: cenbii-procid-ubl
- x-scrada-peppol-process-value: urn:fdc:peppol.eu:2017:poacc:billing:01:1.0
- x-scrada-peppol-receiver-id: 0208:0755799452
- x-scrada-peppol-receiver-scheme: iso6523-actorid-upis
- x-scrada-peppol-sender-id: 0208:0755799452
- x-scrada-peppol-sender-scheme: iso6523-actorid-upis

## Send Result
- Channel: unknown
- Final status: failure
- Artifacts: artifacts/scrada/json-sent.json; artifacts/scrada/ubl-sent.xml; artifacts/scrada/headers-sent.txt; artifacts/scrada/error-body.txt; artifacts/scrada/scrada-send-output.log; artifacts/scrada/scrada-send-output.json
- Error preview:
  - [2025-11-08T22:12:50.406Z] attempt=1 channel=ubl vatVariant=BE0755799452 docIndex=1 procIndex=1 status=500 error=[scrada] Failed to send UBL document (HTTP 500) : {"errorCode":-1,"errorType":1,"defaultFormat":"The provided document type and process are invalid or currently not supported.","parameters":[],"innerErrors":[]} data={"errorCode":-1,"errorType":1,"defaultFormat":"The provided document type and process are invalid or currently not supported.","parameters":[],"innerErrors":[]}
  - {"errorCode":-1,"errorType":1,"defaultFormat":"The provided document type and process are invalid or currently not supported.","parameters":[],"innerErrors":[]}
- Support bundle: output/scrada_support_bundle_19199300477.zip

