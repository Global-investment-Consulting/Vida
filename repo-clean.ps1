param([switch]$DryRun = $true)

function Info($msg){ Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Act($msg){ if($DryRun){ Write-Host "[DRY]  $msg" -ForegroundColor Yellow } else { Write-Host "[DO]   $msg" -ForegroundColor Green } }
function Ensure-Dir($p){ if(-not (Test-Path $p)){ Act "Create dir: $p"; if(-not $DryRun){ New-Item -ItemType Directory -Force -Path $p | Out-Null } } }
function Move-Safe($from,$to){
  if(-not (Test-Path $from)){ return }
  $destDir = Split-Path $to -Parent
  Ensure-Dir $destDir
  Act "Move: $from  ->  $to"
  if(-not $DryRun){ Move-Item -Force -Path $from -Destination $to }
}

if(-not (Test-Path $RepoRoot)){ throw "Repo path not found: $RepoRoot" }
Set-Location $RepoRoot
Info "Working in $RepoRoot"

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ArchiveRoot = Join-Path $RepoRoot "_archive\$Stamp"
Ensure-Dir $ArchiveRoot

$ScriptsDir = Join-Path $RepoRoot "scripts"
$DashDir    = Join-Path $RepoRoot "dashboard"
Ensure-Dir $ScriptsDir
Ensure-Dir $DashDir

$KeepServer = Join-Path $RepoRoot "server.js"
$KeepPkgAPI = Join-Path $RepoRoot "package.json"
$KeepSmoke  = Join-Path $ScriptsDir "smoke.ps1"

# 1) other server.js
$serverHits = Get-ChildItem -Recurse -File -Filter "server.js" | Where-Object { $_.FullName -ne $KeepServer }
foreach($hit in $serverHits){ Move-Safe $hit.FullName (Join-Path $ArchiveRoot ("server_js_" + ($hit.FullName.Replace(':','').Replace('\','_')))) }

# 2) package.json not in root or dashboard
$pkgHits = Get-ChildItem -Recurse -File -Filter "package.json" | Where-Object { $_.DirectoryName -ne $RepoRoot -and $_.DirectoryName -ne $DashDir }
foreach($hit in $pkgHits){ Move-Safe $hit.FullName (Join-Path $ArchiveRoot ("package_json_" + ($hit.FullName.Replace(':','').Replace('\','_')))) }

# 3) dashboard-like dirs not at /dashboard
$dashish = Get-ChildItem -Directory -Recurse | Where-Object { $_.FullName -ne $DashDir -and ($_.Name -match "dashboard|ui|frontend|web") }
foreach($d in $dashish){ Move-Safe $d.FullName (Join-Path $ArchiveRoot ("dash_" + $d.Name)) }

# 4) legacy trees often seen
foreach($p in @("src\pdf","src\xml","client","ui","web","frontend","app")){
  $full = Join-Path $RepoRoot $p
  if(Test-Path $full){ Move-Safe $full (Join-Path $ArchiveRoot $p) }
}

# 5) smoke.ps1 — keep newest in scripts/
$smokes = Get-ChildItem -Recurse -Filter "smoke.ps1"
if($smokes.Count -gt 0){
  $latest = $smokes | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if($latest.FullName -ne $KeepSmoke){ Move-Safe $latest.FullName $KeepSmoke }
  foreach($s in ($smokes | Where-Object { $_.FullName -ne $latest.FullName })){
    Move-Safe $s.FullName (Join-Path $ArchiveRoot ("smoke_dup_" + ($s.FullName.Replace(':','').Replace('\','_'))))
  }
}else{ Info "No smoke.ps1 found; skipping." }

# 6) .gitignore baseline if missing
$gitignore = @"
node_modules/
dashboard/node_modules/
data/*.json
data/*.bak
_archive/
.DS_Store
*.log
"@
$GitIgnorePath = Join-Path $RepoRoot ".gitignore"
if(-not (Test-Path $GitIgnorePath)){ Act "Create .gitignore"; if(-not $DryRun){ Set-Content -Path $GitIgnorePath -Value $gitignore -Encoding UTF8 } }

Info "Audit complete."
Write-Host "Archive folder prepared at: $ArchiveRoot" -ForegroundColor Yellow
if($DryRun){ Write-Host "`nDRY RUN finished. Re-run without -DryRun to apply." -ForegroundColor Yellow } else { Write-Host "`nApplied. Review _archive and run tests." -ForegroundColor Green }
