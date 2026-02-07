#!/usr/bin/env pwsh
param(
  [int]$GatewayPort = 19001,
  [int]$UiPort = 5173,
  [string]$BindHost = "127.0.0.1"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

function Test-PortInUse {
  param([int]$Port)

  try {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
  } catch {
    $netstat = netstat -ano | Select-String -Pattern (":$Port\s")
    return $null -ne $netstat
  }
}

function Get-FreeUiPort {
  param([int]$StartPort)

  $candidate = $StartPort
  while (Test-PortInUse -Port $candidate) {
    $candidate += 1
  }
  return $candidate
}

Write-Host "[openclaw] repo: $repoRoot"

$gatewayAlreadyRunning = Test-PortInUse -Port $GatewayPort
$gatewayProcess = $null

if ($gatewayAlreadyRunning) {
  Write-Host "[openclaw] gateway port $GatewayPort already in use, reusing existing gateway."
} else {
  $gatewayOutLog = Join-Path $env:TEMP "openclaw-gateway-dev.out.log"
  $gatewayErrLog = Join-Path $env:TEMP "openclaw-gateway-dev.err.log"
  foreach ($logFile in @($gatewayOutLog, $gatewayErrLog)) {
    if (Test-Path $logFile) {
      Remove-Item $logFile -Force -ErrorAction SilentlyContinue
    }
  }

  Write-Host "[openclaw] starting gateway via: corepack pnpm dev"
  $gatewayProcess = Start-Process -FilePath "corepack" `
    -ArgumentList @("pnpm", "dev") `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $gatewayOutLog `
    -RedirectStandardError $gatewayErrLog `
    -PassThru

  Write-Host "[openclaw] gateway pid: $($gatewayProcess.Id), logs: $gatewayOutLog | $gatewayErrLog"
}

$deadline = (Get-Date).AddSeconds(35)
while (-not (Test-PortInUse -Port $GatewayPort)) {
  if ((Get-Date) -ge $deadline) {
    Write-Host "[openclaw] warning: gateway port $GatewayPort not ready after 35s."
    break
  }
  Start-Sleep -Milliseconds 500
}

$resolvedUiPort = Get-FreeUiPort -StartPort $UiPort
if ($resolvedUiPort -ne $UiPort) {
  Write-Host "[openclaw] ui port $UiPort busy, switched to $resolvedUiPort."
}

Write-Host "[openclaw] starting ui via: corepack pnpm --dir ui dev --host $BindHost --port $resolvedUiPort"
Push-Location $repoRoot
try {
  & corepack pnpm --dir ui dev --host $BindHost --port $resolvedUiPort
} finally {
  Pop-Location
}
