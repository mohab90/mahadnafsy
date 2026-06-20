[CmdletBinding()]
param(
  [int]$ClientPort = 3100,
  [int]$AdminPort = 4100,
  [int]$ApiPort = 3101,
  [switch]$SkipApi,
  [switch]$SkipClient,
  [switch]$SkipAdmin
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$LogDir = Join-Path $Root '.local-logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-PortInUse {
  param([int]$Port)
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

function Start-MahadProcess {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Command,
    [string]$LogPath
  )

  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/d', '/c', "$Command > `"$LogPath`" 2>&1" `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden

  Write-Host "$Name starting. Log: $LogPath"
}

$apiBase = "http://127.0.0.1:$ApiPort/api"

if (-not $SkipApi) {
  if (Test-PortInUse $ApiPort) {
    Write-Warning "API port $ApiPort is already in use. Skipping API start."
  } else {
    Start-MahadProcess 'API' (Join-Path $Root 'api') "set PORT=$ApiPort&& npm start" (Join-Path $LogDir "api-$ApiPort.log")
  }
}

if (-not $SkipClient) {
  if (Test-PortInUse $ClientPort) {
    Write-Warning "Client port $ClientPort is already in use. Skipping client start."
  } else {
    Start-MahadProcess 'Client' (Join-Path $Root 'client') "set VITE_API_URL=$apiBase&& npm run dev -- --host 127.0.0.1 --port $ClientPort --strictPort" (Join-Path $LogDir "client-$ClientPort.log")
  }
}

if (-not $SkipAdmin) {
  if (Test-PortInUse $AdminPort) {
    Write-Warning "Admin port $AdminPort is already in use. Skipping admin start."
  } else {
    Start-MahadProcess 'Admin' (Join-Path $Root 'admin') "set VITE_API_URL=$apiBase&& npm run dev -- --host 127.0.0.1 --port $AdminPort --strictPort" (Join-Path $LogDir "admin-$AdminPort.log")
  }
}

Write-Host ''
Write-Host "Alternate runtime targets:"
Write-Host "  Client: http://127.0.0.1:$ClientPort/"
Write-Host "  Admin:  http://127.0.0.1:$AdminPort/"
Write-Host "  API live:  http://127.0.0.1:$ApiPort/api/health/live"
Write-Host "  API ready: http://127.0.0.1:$ApiPort/api/health"
Write-Host "  API base for Vite: $apiBase"
