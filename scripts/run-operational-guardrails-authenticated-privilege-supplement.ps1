$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repo = "D:\OpenGlass Hub interaction-release-fresh"
$branch = "feature/legal-trust-consent-foundation-v1"
$packet = Join-Path $repo "docs\ops\reconciliation\operational-guardrails-authenticated-privilege-supplemental-preflight.sql"
$validator = Join-Path $repo "scripts\validate-operational-guardrails-authenticated-privilege-supplement.mjs"
$finalCsv = "C:\Users\1\Downloads\operational-guardrails-authenticated-privilege-supplement.csv"
$image = "public.ecr.aws/supabase/postgres:17.6.1.143@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453"
$digest = "sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453"
$packetHash = "d96e76f9dd3655c03a64dc5d535087fc63f99370b13b246f6529caaf121cd074"
$packetBytes = 8674
$mountedPacket = "/reviewed/operational-guardrails-authenticated-privilege-supplemental-preflight.sql"
$mountedOutput = "/tmp/operational-guardrails-authenticated-privilege-supplement.csv"
$outputDirectory = Split-Path -Parent $finalCsv
$runId = [guid]::NewGuid().ToString("N")
$stagingCsv = Join-Path $outputDirectory ".operational-guardrails-authenticated-privilege-supplement.$runId.partial.csv"

function Quarantine-StagingCsv {
  if (-not (Test-Path -LiteralPath $stagingCsv)) { return }
  $length = (Get-Item -LiteralPath $stagingCsv).Length
  if ($length -eq 0) {
    Remove-Item -LiteralPath $stagingCsv -Force
    return
  }
  $quarantine = Join-Path $outputDirectory ".operational-guardrails-authenticated-privilege-supplement.$runId.failed.csv"
  [System.IO.File]::Move($stagingCsv, $quarantine)
  [Console]::Error.WriteLine("Stopped. Non-empty output was quarantined at $quarantine. Do not retry or inspect it outside the offline validator.")
}

try {
  Set-Location $repo
  if ((git status --porcelain).Length -ne 0) { throw "Stop: worktree is not clean." }
  if ((git rev-parse --abbrev-ref HEAD).Trim() -ne $branch -or (git rev-parse HEAD).Trim() -ne (git rev-parse "origin/$branch").Trim()) { throw "Stop: branch or origin state mismatch." }
  if ((Get-FileHash -LiteralPath $packet -Algorithm SHA256).Hash.ToLowerInvariant() -ne $packetHash) { throw "Stop: reviewed SQL hash mismatch." }
  if ((Get-Item -LiteralPath $packet).Length -ne $packetBytes) { throw "Stop: reviewed SQL byte-count mismatch." }
  if (Test-Path -LiteralPath $finalCsv) { throw "Stop: approved final CSV already exists; it will not be overwritten." }
  if (-not (Test-Path -LiteralPath $outputDirectory)) { throw "Stop: approved output directory is missing." }
  foreach ($name in "PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE") { if (Test-Path "Env:$name") { throw "Stop: forbidden credential environment variable exists: $name" } }
  foreach ($path in @("$HOME\.pgpass", "$HOME\.pg_service.conf")) { if (Test-Path -LiteralPath $path) { throw "Stop: forbidden credential file exists: $path" } }
  if (-not ((docker image inspect $image --format "{{json .RepoDigests}}") -match [regex]::Escape($digest))) { throw "Stop: pinned PostgreSQL image digest mismatch." }

  $projectName = Read-Host "Type the confirmed Dashboard project name"
  $directHost = Read-Host "Paste Dashboard Direct Connection host"
  $directPort = Read-Host "Paste Dashboard Direct Connection port"
  $directDatabase = Read-Host "Paste Dashboard Direct Connection database"
  $directUser = Read-Host "Paste Dashboard Direct Connection user"
  if ($projectName -ne "OpenGlass Hub") { throw "Stop: production project identity was not confirmed." }
  if ($directHost -match "(?i)pooler|supavisor|://|[\s/@?#]" -or $directPort -notmatch "^\d{1,5}$" -or $directDatabase -match "[\s=;]" -or $directUser -match "\s") { throw "Stop: invalid direct-connection parameter format." }

  $handle = [System.IO.File]::Open($stagingCsv, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $handle.Dispose()
  & docker run --rm -it --read-only `
    --mount "type=bind,src=$packet,dst=$mountedPacket,readonly" `
    --mount "type=bind,src=$stagingCsv,dst=$mountedOutput" `
    $image psql -X -W -q --csv -v ON_ERROR_STOP=1 `
      -h $directHost -p $directPort -U $directUser `
      -d "dbname=$directDatabase sslmode=require" `
      -f $mountedPacket -o $mountedOutput
  if ($LASTEXITCODE -ne 0) { throw "Stopped: psql failed with exit code $LASTEXITCODE. Do not retry." }
  if ((Get-Item -LiteralPath $stagingCsv).Length -eq 0) { throw "Stopped: psql exited zero but produced no CSV evidence." }
  & node $validator $stagingCsv
  if ($LASTEXITCODE -ne 0) { throw "Stopped: offline validator failed. Do not retry." }
  [System.IO.File]::Move($stagingCsv, $finalCsv)
  Write-Host "SUCCESS: psql exited zero, the exact eight-section CSV validated, and the final CSV was atomically created."
} catch {
  Quarantine-StagingCsv
  throw
}
