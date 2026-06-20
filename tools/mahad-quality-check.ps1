[CmdletBinding()]
param(
  [int]$ClientPort = 3000,
  [int]$AdminPort = 4000,
  [int]$ApiPort = 3001,
  [switch]$SkipAudit,
  [switch]$SkipBuild,
  [switch]$Json
)

$ErrorActionPreference = 'Continue'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Results = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Name,
    [ValidateSet('PASS','FAIL','BLOCKED','INFO')]
    [string]$Status,
    [string]$Detail = ''
  )
  $Results.Add([pscustomobject]@{
    Name = $Name
    Status = $Status
    Detail = $Detail.Trim()
  }) | Out-Null
}

function Invoke-ProjectCommand {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Command,
    [switch]$ExitCodeTwoIsBlocked
  )

  Push-Location $WorkingDirectory
  try {
    $output = & cmd.exe /d /c $Command 2>&1
    $code = $LASTEXITCODE
  } catch {
    $output = @($_.Exception.Message)
    $code = 1
  } finally {
    Pop-Location
  }

  $tail = (($output | Select-Object -Last 12) -join "`n")
  if ($code -eq 0) {
    Add-Check $Name 'PASS' $tail
  } elseif ($ExitCodeTwoIsBlocked -and $code -eq 2) {
    Add-Check $Name 'BLOCKED' $tail
  } else {
    Add-Check $Name 'FAIL' $tail
  }
}

function Test-ApiSyntax {
  $apiDir = Join-Path $Root 'api'
  Push-Location $apiDir
  try {
    if (Get-Command rg -ErrorAction SilentlyContinue) {
      $files = & rg --files -g '!**/node_modules/**' -g '*.js'
    } else {
      $files = Get-ChildItem -Recurse -File -Filter *.js |
        Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
        ForEach-Object { $_.FullName }
    }

    $failures = @()
    foreach ($file in $files) {
      $check = & node --check $file 2>&1
      if ($LASTEXITCODE -ne 0) {
        $failures += "$file`n$check"
      }
    }

    if ($failures.Count -eq 0) {
      Add-Check 'api node --check' 'PASS' "Checked $($files.Count) JS files."
    } else {
      Add-Check 'api node --check' 'FAIL' (($failures | Select-Object -First 5) -join "`n")
    }
  } finally {
    Pop-Location
  }
}

function Test-Http {
  param(
    [string]$Name,
    [string]$Url,
    [switch]$DbBacked
  )

  try {
    $res = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 10
    Add-Check $Name 'PASS' "HTTP $($res.StatusCode) $Url"
  } catch {
    $status = $null
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
    }

    if ($DbBacked -and $status -eq 503) {
      Add-Check $Name 'BLOCKED' "HTTP 503 at $Url. API is reachable, but DB-backed health is unavailable. Check MySQL on 127.0.0.1:3306."
    } else {
      Add-Check $Name 'FAIL' "$Url failed: $($_.Exception.Message)"
    }
  }
}

if (-not $SkipAudit) {
  Invoke-ProjectCommand 'api npm audit --omit=dev' (Join-Path $Root 'api') 'npm audit --omit=dev'
  Invoke-ProjectCommand 'admin npm audit --omit=dev' (Join-Path $Root 'admin') 'npm audit --omit=dev'
  Invoke-ProjectCommand 'client npm audit --omit=dev' (Join-Path $Root 'client') 'npm audit --omit=dev'
}

Test-ApiSyntax

if (-not $SkipBuild) {
  Invoke-ProjectCommand 'admin npm run build' (Join-Path $Root 'admin') 'npm run build'
  Invoke-ProjectCommand 'client npm run build' (Join-Path $Root 'client') 'npm run build'
}

Test-Http 'client smoke' "http://127.0.0.1:$ClientPort/"
Test-Http 'admin smoke' "http://127.0.0.1:$AdminPort/"
Test-Http 'api liveness' "http://127.0.0.1:$ApiPort/api/health/live"
Test-Http 'api db readiness' "http://127.0.0.1:$ApiPort/api/health" -DbBacked
Invoke-ProjectCommand 'api route smoke' $Root "node tools\mahad-api-smoke.mjs $ApiPort" -ExitCodeTwoIsBlocked

if ($Json) {
  $Results | ConvertTo-Json -Depth 4
} else {
  $Results | Format-Table -AutoSize
}

$failed = @($Results | Where-Object { $_.Status -eq 'FAIL' }).Count
if ($failed -gt 0) {
  exit 1
}
exit 0
