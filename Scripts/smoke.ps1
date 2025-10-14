param([string]$API="http://localhost:3001",[string]$KEY="key_test_12345")
$ErrorActionPreference="Stop"

function GET($p){
  Invoke-WebRequest -UseBasicParsing -Headers @{Authorization="Bearer $KEY"} -Uri ($API+$p)
}

function GETQ($p){
  $sep = if($p -match '\?'){ '&' } else { '?' }
  Invoke-WebRequest -UseBasicParsing -Uri ($API + $p + $sep + "access_token=$KEY")
}

function POSTJSON($p,$o){
  Invoke-WebRequest -UseBasicParsing -Headers @{Authorization="Bearer $KEY";"Content-Type"="application/json"} `
    -Uri ($API+$p) -Method POST -Body ($o|ConvertTo-Json -Depth 10)
}

Write-Host "==> List"
( GET "/v1/invoices?limit=1" | Select StatusCode ) | Out-Host

Write-Host "`n==> Create"
$inv=@{
  externalId="ext_"+([guid]::NewGuid().ToString("N").Substring(0,8))
  currency="EUR"
  buyer=@{ name="Test Buyer"; vatId="BE0123456789"; email="buyer@example.com" }
  lines=@(@{ description="Test line"; quantity=1; unitPriceMinor=12345; vatRate=21 })
}
$r=POSTJSON "/v1/invoices" $inv
$id=($r.Content|ConvertFrom-Json).id
Write-Host "created id: $id"

Write-Host "`n==> Docs via query token (expected 200)"
( GETQ "/v1/invoices/$id/pdf" | Select StatusCode, ContentType ) | Out-Host
( GETQ "/v1/invoices/$id/xml" | Select StatusCode, ContentType ) | Out-Host

Write-Host "`n==> Docs via Bearer header (also expected 200)"
( GET "/v1/invoices/$id/pdf" | Select StatusCode, ContentType ) | Out-Host
( GET "/v1/invoices/$id/xml" | Select StatusCode, ContentType ) | Out-Host
