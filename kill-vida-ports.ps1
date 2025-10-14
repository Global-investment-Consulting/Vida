# kill-vida-ports.ps1
# Frees ports 3001 (API) and 5173 (Dashboard) on Windows.

$ErrorActionPreference = 'SilentlyContinue'
$ports = @(3001, 5173)

function Kill-Pids([int[]]$pids, [int]$port) {
  foreach ($pid in ($pids | Select-Object -Unique)) {
    try {
      if ($pid -gt 0) {
        Stop-Process -Id $pid -Force -ErrorAction Stop
        Write-Host ("Killed PID {0} (port {1})" -f $pid, $port) -ForegroundColor Green
      }
    } catch {
      Write-Host ("Could not kill PID {0} (port {1}): {2}" -f $pid, $port, $_.Exception.Message) -ForegroundColor Yellow
    }
  }
}

foreach ($port in $ports) {
  $pids = @()

  # Preferred: modern API
  try {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    if ($conns) {
      $pids += ($conns | Select-Object -ExpandProperty OwningProcess)
    }
  } catch { }

  # Fallback: parse netstat if above isn't available
  if (-not $pids -or $pids.Count -eq 0) {
    $lines = netstat -ano | findstr ":$port"
    foreach ($line in $lines) {
      $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
      if ($parts.Length -ge 5) {
        $pid = $parts[-1]
        if ($pid -match '^\d+$') { $pids += [int]$pid }
      }
    }
  }

  if ($pids -and $pids.Count -gt 0) {
    Kill-Pids -pids $pids -port $port
  } else {
    Write-Host ("Port {0} is already free" -f $port) -ForegroundColor Cyan
  }
}

Write-Host "Done." -ForegroundColor White
