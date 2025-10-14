# Scripts/smoke.ps1
# -----------------------------------------------------------------------------
# Simple CI smoke test for ViDA MVP API
# -----------------------------------------------------------------------------
param()

$ErrorActionPreference = "Stop"

$baseUrl = "http://localhost:3001"
$headers = @{
    Authorization = "Bearer key_test_12345"
}
Write-Host "🔍 Smoke test started at $baseUrl"

# Wait up to 45s for the API to become reachable
$max = 45
for ($i = 1; $i -le $max; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl/openapi.json" -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            Write-Host "✅ API reachable after $i sec"
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
    if ($i -eq $max) {
        throw "❌ API not reachable after ${max}s"
    }
}

# 1) List invoices
Write-Host "→ GET /v1/invoices"
$r = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/v1/invoices?limit=1" -Headers $headers
$r.StatusCode | Should -Be 200

# 2) Create a new invoice
Write-Host "→ POST /v1/invoices"
$body = @{
    externalId = "ext_ci_test"
    currency   = "EUR"
    buyer      = @{ name = "CI Buyer"; email = "ci@example.com" }
    lines      = @(@{ description = "Test service"; quantity = 1; unitPriceMinor = 10000; vatRate = 21 })
} | ConvertTo-Json -Depth 5
$r = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/v1/invoices" -Headers $headers -Method POST -Body $body -ContentType "application/json"
$r.StatusCode | Should -Be 201

Write-Host "✅ Smoke test finished successfully"
exit 0
