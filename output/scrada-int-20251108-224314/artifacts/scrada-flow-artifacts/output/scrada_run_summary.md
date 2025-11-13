# Summary
- Run URL: https://github.com/Global-investment-Consulting/Vida/actions/runs/19198972477
- SHA: c642f0c08f647340ab54b3ed3114d3f65dfdb157
- Adapter=scrada
- Isolation: Isolation=OK

## Header values
- (no UBL header preview captured)

## Send Result
- Channel: unknown
- Final status: failure
- Artifacts: artifacts/scrada/json-sent.json; artifacts/scrada/ubl-sent.xml; artifacts/scrada/headers-sent.txt; artifacts/scrada/error-body.txt; artifacts/scrada/scrada-send-output.log; artifacts/scrada/scrada-send-output.json
- Error preview:
  - [2025-11-08T21:39:46.285Z] attempt=1 channel=json vatVariant=BE0755799452 status=500 error=[scrada] Failed to send sales invoice JSON (HTTP 500) : {"errorCode":110634,"errorType":1,"defaultFormat":"One or more errors occurred.","parameters":[],"innerErrors":[{"errorCode":110636,"errorType":1,"defaultFormat":"The field 'TotalInclVat' cannot be used on invoice line 1. Please clear this value when isInclVat is False.","parameters":["TotalInclVat","1","False"],"innerErrors":[]}]} data={"errorCode":110634,"errorType":1,"defaultFormat":"One or more errors occurred.","parameters":[],"innerErrors":[{"errorCode":110636,"errorType":1,"defaultFormat":"The field 'TotalInclVat' cannot be used on invoice line 1. Please clear this value when isInclVat is False.","parameters":["TotalInclVat","1","False"],"innerErrors":[]}]}
  - {"errorCode":110634,"errorType":1,"defaultFormat":"One or more errors occurred.","parameters":[],"innerErrors":[{"errorCode":110636,"errorType":1,"defaultFormat":"The field 'TotalInclVat' cannot be used on invoice line 1. Please clear this value when isInclVat is False.","parameters":["TotalInclVat","1","False"],"innerErrors":[]}]}
- Support bundle: output/scrada_support_bundle_19198972477.zip

