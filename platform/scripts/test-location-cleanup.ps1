# Run from repo root: .\platform\scripts\test-location-cleanup.ps1
# Requires CRON_SECRET (same value as Supabase Edge Function secret).
# Example:
#   $env:CRON_SECRET = 'paste-from-Supabase-Secrets'
#   .\platform\scripts\test-location-cleanup.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root "web\.env"
if (-not (Test-Path $envFile)) {
  Write-Error "web\.env not found. Create platform\web\.env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
}

if ([string]::IsNullOrWhiteSpace($env:CRON_SECRET)) {
  Write-Error "CRON_SECRET env var is required. Set `$env:CRON_SECRET to the Supabase secret before calling this script."
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
  Authorization   = "Bearer $key"
  apikey          = $key
  "Content-Type"  = "application/json"
  "x-cron-secret" = $env:CRON_SECRET
}

Write-Host "POST $uri (x-cron-secret header set; anon key used only as gateway apikey)"

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
