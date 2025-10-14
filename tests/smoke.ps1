# tests/smoke.ps1 — simple wrapper for CI
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path (Join-Path $here "..")
$real = Join-Path $repoRoot "Scripts\smoke.ps1"

Write-Host "CI wrapper -> $real"
powershell -ExecutionPolicy Bypass -File $real
