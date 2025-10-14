# Scripts/smoke.ps1
$ErrorActionPreference = "Stop"
$API = "http://localhost:3001"
$KEY = $env:API_KEY; if (-not $KEY) { $KEY = "key_test_12345" }

function GET($p) {
  Invoke-WebRequest -UseBasicParsing -Headers @{Authorization="Bearer $KEY"} -Uri ("$API$p")
}

Write-Host "🔎 Smoke test starting at $API"

# quick readiness probe (up to 45s here; the workflow already waited too)
$max = 45
for ($i=0; $i -lt $max; $i++) {
  try { $r = Invoke-WebRequest "$API/openapi.json" -TimeoutSec 2; if ($r.StatusCode -eq 200) { break } } catch {}
  Start-Sleep -Seconds 1
}
if ($i -ge $max) { throw "❌ API not reachable after ${max}s" }

# List -> Create -> List -> PDF -> XML
$r = GET "/v1/invoices?limit=1" | Select-Object -ExpandProperty Content
Write-Host "List OK"

$body = @{
  externalId = "ext_" + [guid]::NewGuid().ToString()
  currency   = "EUR"
  buyer      = @{ name="Test Buyer"; email="buyer@example.com" }
  lines      = @(@{ description="Service"; quantity=1; unitPriceMinor=12345 })
} | ConvertTo-Json -Depth 5

$resp = Invoke-WebRequest -Method POST -Headers @{Authorization="Bearer $KEY"; "Content-Type"="application/json"} -Body $body -Uri "$API/v1/invoices" -UseBasicParsing
$json = $resp.Content | ConvertFrom-Json
$id = $json.id
if (-not $id) { throw "Create did not return id" }
Write-Host "Create OK ($id)"

GET "/v1/invoices?limit=1" | Out-Null
Write-Host "List again OK"

GET "/v1/invoices/$id/pdf" | Out-Null
Write-Host "PDF OK"

GET "/v1/invoices/$id/xml" | Out-Null
Write-Host "XML OK"

Write-Host "✅ Smoke passed"
