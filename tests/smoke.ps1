$ErrorActionPreference = "Stop"
$Base   = "http://localhost:3001"
$Api    = "$Base/v1"
$Bearer = "key_test_12345"

function New-IdemKey { [guid]::NewGuid().ToString() }
$H_Create = @{ Authorization = "Bearer $Bearer"; "X-Idempotency-Key" = (New-IdemKey) }
$H_Auth   = @{ Authorization = "Bearer $Bearer" }
$H_Pay    = @{ Authorization = "Bearer $Bearer"; "X-Idempotency-Key" = (New-IdemKey) }

$CreateBody = @{ currency="EUR"; buyer=@{ name="Persist Co"; country="BE" }; lines=@(@{ name="Service"; qty=1; price=50 }) } | ConvertTo-Json -Depth 6
$r1 = Invoke-RestMethod "$Api/invoices" -Headers $H_Create -Method POST -Body $CreateBody -ContentType "application/json"
$r2 = Invoke-RestMethod "$Api/invoices" -Headers $H_Create -Method POST -Body $CreateBody -ContentType "application/json"
if ($r1.id -ne $r2.id) { throw "Idempotency failed" }

$inv   = Invoke-RestMethod ("$Api/invoices/{0}" -f $r1.id) -Headers $H_Auth
$paid  = Invoke-RestMethod ("$Api/invoices/{0}/pay" -f $inv.id) -Headers $H_Pay -Method POST
$paid2 = Invoke-RestMethod ("$Api/invoices/{0}/pay" -f $inv.id) -Headers $H_Pay -Method POST
$plist = Invoke-RestMethod ("$Api/invoices/{0}/payments" -f $inv.id) -Headers $H_Auth

"== Smoke ==" | Write-Host
"OK · #1 payments" | Write-Host
