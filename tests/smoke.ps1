# tests/smoke.ps1
$ErrorActionPreference = "Stop"

$Base   = "http://localhost:3001"
$Api    = "$Base/v1"
$Bearer = "key_test_12345"

function New-IdemKey { [guid]::NewGuid().ToString() }
function Check($cond, $msg) { if (-not $cond) { throw $msg } }

$H_Create = @{ Authorization = "Bearer $Bearer"; "X-Idempotency-Key" = (New-IdemKey) }
$H_Auth   = @{ Authorization = "Bearer $Bearer" }

Write-Host "== Smoke =="
$r1 = Invoke-RestMethod "$Api/invoices" -Headers $H_Create -Method POST -Body (@{
  currency="EUR"; buyer=@{name="Persist Co"; country="BE"}; lines=@(@{name="Service"; qty=1; price=50})
} | ConvertTo-Json -Depth 6) -ContentType "application/json"

$r2 = Invoke-RestMethod "$Api/invoices" -Headers $H_Create -Method POST -Body (@{
  currency="EUR"; buyer=@{name="Persist Co"; country="BE"}; lines=@(@{name="Service"; qty=1; price=50})
} | ConvertTo-Json -Depth 6) -ContentType "application/json"

Check ($r1.id -eq $r2.id) "Idempotency failed"
$inv = Invoke-RestMethod ("$Api/invoices/{0}" -f $r1.id) -Headers $H_Auth

$patched = Invoke-RestMethod ("$Api/invoices/{0}" -f $inv.id) -Headers $H_Auth -Method PATCH `
  -Body (@{ buyer=@{ name="Persist Co (Patched)" } } | ConvertTo-Json -Depth 6) -ContentType "application/json"

(Invoke-WebRequest ("$Api/invoices/{0}/xml" -f $inv.id) -Headers $H_Auth).Content | Out-File -Encoding UTF8 ("invoice_{0}.xml" -f $inv.number)
Invoke-WebRequest ("$Api/invoices/{0}/pdf?access_token=$Bearer" -f $inv.id) -OutFile ("invoice_{0}.pdf" -f $inv.number)

$H_Pay = @{ Authorization="Bearer $Bearer"; "X-Idempotency-Key"=(New-IdemKey) }
$paid  = Invoke-RestMethod ("$Api/invoices/{0}/pay" -f $inv.id) -Headers $H_Pay -Method POST
$paid2 = Invoke-RestMethod ("$Api/invoices/{0}/pay" -f $inv.id) -Headers $H_Pay -Method POST

$plist = Invoke-RestMethod ("$Api/invoices/{0}/payments" -f $inv.id) -Headers $H_Auth
Write-Host ("OK · #{0} payments" -f $plist.data.Count)
