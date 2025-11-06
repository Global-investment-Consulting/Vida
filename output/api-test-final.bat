@echo off
setlocal

REM Usage: api-test-final.bat path\to\invoice.xml [external-reference]

if "%~1"=="" (
  echo Usage: %~nx0 path\to\invoice.xml [external-reference]
  exit /b 1
)

if "%SCRADA_COMPANY_ID%"=="" (
  echo SCRADA_COMPANY_ID must be set to your Scrada tenant identifier.
  exit /b 1
)

set "PAYLOAD=%~1"
if not exist "%PAYLOAD%" (
  echo File "%PAYLOAD%" not found.
  exit /b 1
)

set "EXTERNAL_REF=%~2"
if "%EXTERNAL_REF%"=="" (
  for %%F in ("%PAYLOAD%") do set "EXTERNAL_REF=%%~nF"
)

set "SCRADA_ENDPOINT=https://apitest.scrada.be/v1/company/%SCRADA_COMPANY_ID%/peppol/outbound/document"

echo Sending "%PAYLOAD%" to %SCRADA_ENDPOINT%
echo.
curl ^
  -X POST "%SCRADA_ENDPOINT%" ^
  -H "Content-Type: application/xml; charset=utf-8" ^
  -H "x-scrada-external-reference: %EXTERNAL_REF%" ^
  -H "x-scrada-peppol-c1-country-code: BE" ^
  -H "x-scrada-peppol-document-type-scheme: busdox-docid-qns" ^
  -H "x-scrada-peppol-document-type-value: urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1" ^
  -H "x-scrada-peppol-process-scheme: cenbii-procid-ubl" ^
  -H "x-scrada-peppol-process-value: urn:fdc:peppol.eu:2017:poacc:billing:01:1.0" ^
  -H "x-scrada-peppol-receiver-party-id: iso6523-actorid-upis:0208:0755799452" ^
  -H "x-scrada-peppol-sender-scheme: iso6523-actorid-upis" ^
  -H "x-scrada-peppol-sender-id: 0208:0755799452" ^
  --data-binary "@%PAYLOAD%"

if errorlevel 1 (
  echo.
  echo Request failed. Review the response above and ensure authentication headers are configured as required by your environment.
) else (
  echo.
  echo Request completed.
)

endlocal
