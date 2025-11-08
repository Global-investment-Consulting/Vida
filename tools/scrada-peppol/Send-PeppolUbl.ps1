[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [string]$OutputPath,

  [string]$CompanyId = $env:SCRADA_COMPANY_ID,
  [string]$ApiKey    = $env:SCRADA_API_KEY,
  [string]$Password  = $env:SCRADA_API_PASSWORD,

  [string]$SenderId  = $env:SCRADA_PEPPOL_SENDER_ID,
  [string]$ReceiverId= $env:SCRADA_PEPPOL_RECEIVER_ID,

  [string]$DocType   = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
  [string]$ProcessId = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',

[ValidateSet('test','apitest','prod')]
[string]$Environment = 'apitest',

  [string]$BuyerReference,
  [string]$OrderId,

  [string]$DocumentCurrencyCode = 'EUR',
  [int]$PollSeconds = 300,
  [int]$PollIntervalSeconds = 5,
  [string]$ExternalReference
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info($msg){ Write-Host "[info] $msg" -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Err ($msg){ Write-Host "[error] $msg" -ForegroundColor Red }

if (-not $CompanyId -or -not $ApiKey -or -not $Password) { throw "Missing SCRADA_* credentials. Provide params or set env vars." }
if (-not $SenderId  -or -not $ReceiverId) { throw "Missing SenderId/ReceiverId. Provide params or set env vars SCRADA_PEPPOL_SENDER_ID / SCRADA_PEPPOL_RECEIVER_ID." }

$baseUri = if ($Environment -eq 'prod') { 'https://api.scrada.be' } else { 'https://apitest.scrada.be' }
if (-not $OutputPath) { $OutputPath = [IO.Path]::ChangeExtension($InputPath, 'send.xml') }
if (-not $ExternalReference -or $ExternalReference.Trim().Length -eq 0) {
  $ExternalReference = 'TEST-' + (Get-Date -f yyyyMMdd-HHmmss)
}

# --- Load XML
[string]$raw = Get-Content -LiteralPath $InputPath -Raw
[xml]$xml = $raw
$xml.PreserveWhitespace = $true

# --- NS helpers
$ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
$ns.AddNamespace('inv', $xml.DocumentElement.NamespaceURI)
$cbcNs = $xml.DocumentElement.GetAttribute('xmlns:cbc'); if ($cbcNs) { $ns.AddNamespace('cbc', $cbcNs) } else { $ns.AddNamespace('cbc', 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2') }
$cacNs = $xml.DocumentElement.GetAttribute('xmlns:cac'); if ($cacNs) { $ns.AddNamespace('cac', $cacNs) } else { $ns.AddNamespace('cac', 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2') }

function New-Cbc([string]$name,[string]$val){
  $e = $xml.CreateElement('cbc',$name,$ns.LookupNamespace('cbc'))
  if ($val) { $e.InnerText = $val }
  return $e
}
function New-Cac([string]$name){
  return $xml.CreateElement('cac',$name,$ns.LookupNamespace('cac'))
}

$inv = $xml.SelectSingleNode('/inv:Invoice',$ns)
if(-not $inv){ throw "Could not find <Invoice> root; NS='$($xml.DocumentElement.NamespaceURI)'" }

# --- Ensure ID + IssueDate exist
$idNode = $inv.SelectSingleNode('./cbc:ID',$ns)
if(-not $idNode){
  $idNode = New-Cbc 'ID' ('INV-' + (Get-Date -f yyyyMMddHHmmss))
  $inv.PrependChild($idNode) | Out-Null
}

$issue = $inv.SelectSingleNode('./cbc:IssueDate',$ns)
if(-not $issue){
  $issue = New-Cbc 'IssueDate' (Get-Date -f yyyy-MM-dd)
  $inv.InsertAfter($issue,$idNode) | Out-Null
}

# --- Strip + rebuild minimal BIS header at top
foreach($tag in 'UBLVersionID','CustomizationID','ProfileID','ProfileExecutionID','BuyerReference'){
  $inv.SelectNodes("./cbc:$tag",$ns) | ForEach-Object { $inv.RemoveChild($_) | Out-Null }
}
$inv.SelectNodes('./cac:OrderReference',$ns) | ForEach-Object { $inv.RemoveChild($_) | Out-Null }

$firstElem = ($inv.ChildNodes | Where-Object { $_.NodeType -eq 'Element' } | Select-Object -First 1)
$inv.InsertBefore((New-Cbc 'ProfileExecutionID' '1'), $firstElem) | Out-Null
$inv.InsertBefore((New-Cbc 'ProfileID' 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'), $inv.FirstChild) | Out-Null
$inv.InsertBefore((New-Cbc 'CustomizationID' 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0'), $inv.FirstChild) | Out-Null
$inv.InsertBefore((New-Cbc 'UBLVersionID' '2.1'), $inv.FirstChild) | Out-Null

# --- InvoiceTypeCode=380; DocumentCurrencyCode exists
$itc = $inv.SelectSingleNode('./cbc:InvoiceTypeCode',$ns)
if(-not $itc){ $itc = New-Cbc 'InvoiceTypeCode' '380'; $inv.InsertAfter($itc,$issue)|Out-Null } else { $itc.InnerText = '380' }

$docCur = $inv.SelectSingleNode('./cbc:DocumentCurrencyCode',$ns)
if(-not $docCur){
  $docCur = New-Cbc 'DocumentCurrencyCode' $DocumentCurrencyCode
  $inv.InsertAfter($docCur,$itc) | Out-Null
}

# --- R003: BuyerReference OR OrderReference directly after DocumentCurrencyCode
$anchor = $inv.SelectSingleNode('./cbc:DocumentCurrencyCode',$ns)
if(-not $anchor){ $anchor = $itc }
if(-not $anchor){ $anchor = $issue }

if ($BuyerReference -and $BuyerReference.Trim().Length -gt 0) {
  $br = New-Cbc 'BuyerReference' $BuyerReference
  $inv.InsertAfter($br,$anchor) | Out-Null
} elseif ($OrderId -and $OrderId.Trim().Length -gt 0) {
  $or = New-Cac 'OrderReference'
  $or.AppendChild((New-Cbc 'ID' $OrderId)) | Out-Null
  $inv.InsertAfter($or,$anchor) | Out-Null
} else {
  # safe default (helps tests): generate a BuyerReference
  $br = New-Cbc 'BuyerReference' ('BR-REF-' + (Get-Date -f HHmmss))
  $inv.InsertAfter($br,$anchor) | Out-Null
}

# --- Save UTF-8 (no BOM)
$settings = New-Object System.Xml.XmlWriterSettings
$settings.Encoding = New-Object System.Text.UTF8Encoding($false)
$settings.Indent   = $true
$writer = [System.Xml.XmlWriter]::Create($OutputPath,$settings)
$xml.Save($writer); $writer.Close()

Write-Info "Patched UBL -> $OutputPath"
# Optional preview
($inv.SelectNodes('./cbc:*',$ns) | Select-Object -First 10 | ForEach-Object { $_.OuterXml }) -join "`r`n" | Write-Host

# --- POST to Scrada
$uri = "$baseUri/v1/company/$CompanyId/peppol/outbound/document"
Write-Info "POST $uri"

$docId = (& "$env:WINDIR\System32\curl.exe" -sS $uri `
  -H "X-API-KEY: $ApiKey" -H "X-PASSWORD: $Password" -H "Content-Type: application/xml" `
  -H "x-scrada-peppol-sender-scheme: iso6523-actorid-upis"  -H "x-scrada-peppol-sender-id: $SenderId" `
  -H "x-scrada-peppol-receiver-scheme: iso6523-actorid-upis" -H "x-scrada-peppol-receiver-id: $ReceiverId" `
  -H "x-scrada-peppol-c1-country-code: BE" `
  -H "x-scrada-peppol-document-type-scheme: busdox-docid-qns" `
  -H "x-scrada-peppol-document-type-value: $DocType" `
  -H "x-scrada-peppol-process-scheme: cenbii-procid-ubl" `
  -H "x-scrada-peppol-process-value: $ProcessId" `
  -H "x-scrada-external-reference: $ExternalReference" `
  --data-binary "@$OutputPath").Trim('"')

Write-Host "DOC: $docId  (extRef=$ExternalReference)" -ForegroundColor Yellow
if (-not $docId -or $docId.Length -lt 16) { throw "Unexpected docId returned from Scrada." }

# --- Poll status
$polls = [Math]::Max(1, [Math]::Floor($PollSeconds / $PollIntervalSeconds))
$info = $null
for ($i=0; $i -lt $polls; $i++){
  Start-Sleep -Seconds $PollIntervalSeconds
  $rawInfo = & "$env:WINDIR\System32\curl.exe" -s "$baseUri/v1/company/$CompanyId/peppol/outbound/document/$docId/info" `
              -H "X-API-KEY: $ApiKey" -H "X-PASSWORD: $Password"
  try { $info = $rawInfo | ConvertFrom-Json } catch { $info = $null }
  $att = if ($info) { $info.attempt } else { '' }
  $st  = if ($info) { $info.status }  else { 'Unknown' }
  Write-Host "[status=$st; attempt=$att]" 
  if ($info -and ($info.status -eq 'Delivered' -or $info.status -eq 'Processed' -or $info.status -eq 'Error')) { break }
}

Write-Host "[Result] DOC=$docId STATUS=$($info.status) ATTEMPT=$($info.attempt) ERR=$($info.errorMessage)" -ForegroundColor Green
if ($info -and $info.status -eq 'Error') { exit 1 } else { exit 0 }
