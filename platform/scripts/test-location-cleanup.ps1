# Run from repo root: .\scripts\test-location-cleanup.ps1
# Full test:  $env:CRON_SECRET = 'paste-from-Supabase-Secrets'; .\scripts\test-location-cleanup.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root "web\.env"
if (-not (Test-Path $envFile)) {
  Write-Error "web\.env not found. Set root or create web\.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
}

$base = $null
$key = $null
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*VITE_SUPABASE_URL=(.+)$') { $base = $matches[1].Trim() }
  if ($_ -match '^\s*VITE_SUPABASE_ANON_KEY=(.+)$') { $key = $matches[1].Trim() }
}
if (-not $base -or -not $key) { Write-Error "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in web\.env" }

$uri = "$base/functions/v1/location-cleanup"
$headers = @{
  Authorization  = "Bearer $key"
  "Content-Type" = "application/json"
}
if ($env:CRON_SECRET) { $headers["x-cron-secret"] = $env:CRON_SECRET }

Write-Host "POST $uri"
if (-not $env:CRON_SECRET) { Write-Host "No CRON_SECRET env set; expect 401 if Supabase has CRON_SECRET.`n" }

try {
  $r = Invoke-WebRequest -Uri $uri -Method POST -Headers $headers -UseBasicParsing -TimeoutSec 60
  Write-Host "Status:" $r.StatusCode
  Write-Host $r.Content
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    Write-Host "Status:" ([int]$resp.StatusCode)
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    Write-Host $reader.ReadToEnd()
  } else {
    Write-Host $_.Exception.Message
  }
}
