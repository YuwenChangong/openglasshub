param(
  [Parameter(Mandatory = $true)][ValidatePattern("^[0-9a-fA-F]{40}$")][string]$ExpectedHead
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "lib\operational-guardrails-authenticated-privilege-runner.ps1")
. (Join-Path $PSScriptRoot "lib\operational-guardrails-authenticated-privilege-native-runner.ps1")

$repo = "D:\OpenGlass Hub interaction-release-fresh"
$branch = "feature/legal-trust-consent-foundation-v1"
$packet = Join-Path $repo "docs\ops\reconciliation\operational-guardrails-authenticated-privilege-supplemental-preflight.sql"
$validator = Join-Path $repo "scripts\validate-operational-guardrails-authenticated-privilege-supplement.mjs"
$finalCsv = "C:\Users\1\Downloads\operational-guardrails-authenticated-privilege-supplement.csv"
$packetHash = "d96e76f9dd3655c03a64dc5d535087fc63f99370b13b246f6529caaf121cd074"
$packetBytes = 8674
$outputDirectory = Split-Path -Parent $finalCsv
$runId = [guid]::NewGuid().ToString("N")
$temporaryCsv = $null

try {
  Set-Location $repo
  $gitStatus = @(Invoke-RequiredNativeLines -CommandName "git" -Arguments @("status", "--porcelain"))
  Assert-WorktreeClean -StatusLines $gitStatus
  $branchName = Get-ExactlyOneNativeLine -CommandName "git rev-parse --abbrev-ref HEAD" -OutputLines @(Invoke-RequiredNativeLines -CommandName "git" -Arguments @("rev-parse", "--abbrev-ref", "HEAD"))
  if ($branchName -ne $branch) { throw "Stop: expected branch $branch; found $branchName." }
  $head = Get-ExactlyOneNativeLine -CommandName "git rev-parse HEAD" -OutputLines @(Invoke-RequiredNativeLines -CommandName "git" -Arguments @("rev-parse", "HEAD"))
  $originHead = Get-ExactlyOneNativeLine -CommandName "git rev-parse origin branch" -OutputLines @(Invoke-RequiredNativeLines -CommandName "git" -Arguments @("rev-parse", "origin/$branch"))
  Assert-ExpectedGitRefs -ExpectedHead $ExpectedHead.ToLowerInvariant() -Head $head.ToLowerInvariant() -OriginHead $originHead.ToLowerInvariant()
  if ((Get-FileHash -LiteralPath $packet -Algorithm SHA256).Hash.ToLowerInvariant() -ne $packetHash) { throw "Stop: reviewed SQL hash mismatch." }
  if ([int64](Get-Item -LiteralPath $packet -ErrorAction Stop).Length -ne $packetBytes) { throw "Stop: reviewed SQL byte-count mismatch." }
  if (Test-Path -LiteralPath $finalCsv) { throw "Stop: approved final CSV already exists; it will not be overwritten." }
  if (-not (Test-Path -LiteralPath $outputDirectory)) { throw "Stop: approved output directory is missing." }
  foreach ($name in "PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE") { if (Test-Path "Env:$name") { throw "Stop: forbidden credential environment variable exists: $name" } }
  foreach ($path in @("$HOME\.pgpass", "$HOME\.pg_service.conf")) { if (Test-Path -LiteralPath $path) { throw "Stop: forbidden credential file exists: $path" } }

  $projectName = Read-Host "Type the confirmed Dashboard project name"
  $directHost = Read-Host "Paste Dashboard Direct Connection host"
  $directPort = Read-Host "Paste Dashboard Direct Connection port"
  $directDatabase = Read-Host "Paste Dashboard Direct Connection database"
  $directUser = Read-Host "Paste Dashboard Direct Connection user"
  if ($projectName -ne "OpenGlass Hub") { throw "Stop: production project identity was not confirmed." }
  if ($directHost -match "(?i)pooler|supavisor|://|[\s/@?#]" -or $directPort -notmatch "^\d{1,5}$" -or $directDatabase -match "[\s=;]" -or $directUser -match "\s") { throw "Stop: invalid direct-connection parameter format." }

  $dnsResults = @(Resolve-DnsName -Name $directHost -Type AAAA -DnsOnly -ErrorAction Stop)
  [void](Assert-DirectDnsAaaaResults -ExpectedHost $directHost -Results $dnsResults)
  $psqlCommands = @(Get-Command psql.exe -CommandType Application -ErrorAction SilentlyContinue)
  $psqlPath = Get-NativePsqlPath -Commands $psqlCommands
  $psqlVersionLines = @(& $psqlPath --version)
  $psqlVersionExitCode = $LASTEXITCODE
  Assert-NativeExitCode -CommandName "psql.exe --version" -ExitCode $psqlVersionExitCode
  [void](Get-Postgres17ClientVersion -VersionLines $psqlVersionLines)
  $tcpProbe = Test-NetConnection -ComputerName $directHost -Port ([int]$directPort) -InformationLevel Detailed -WarningAction SilentlyContinue
  Assert-NativeIpv6Reachability -TcpTestSucceeded ([bool]$tcpProbe.TcpTestSucceeded) -ComputerHost $directHost -Port $directPort

  $temporaryCsv = New-ExclusiveTemporaryOutputFile -Directory $outputDirectory -RunId $runId
  Invoke-OnlyAfterPreflight -Preflight { $true } -Action {
    & $psqlPath -X -W -q --csv -v ON_ERROR_STOP=1 `
      -h $directHost -p $directPort -U $directUser `
      -d "dbname=$directDatabase sslmode=require" `
      -f $packet -o $temporaryCsv
    $psqlExitCode = $LASTEXITCODE
    if ($psqlExitCode -ne 0) { throw "Stopped: native psql.exe failed with exit code $psqlExitCode. Do not retry." }
    $validatorOutput = @(& node $validator $temporaryCsv)
    $validatorExitCode = $LASTEXITCODE
    if ($validatorExitCode -ne 0) { throw "Stopped: offline validator failed with exit code $validatorExitCode. Do not retry." }
    Move-ValidatedTemporaryOutput -TemporaryPath $temporaryCsv -FinalPath $finalCsv
    $temporaryCsv = $null
    Write-Host "SUCCESS: native psql.exe exited zero, the exact eight-section CSV validated, and the final CSV was atomically created."
  }
} catch {
  if ($null -ne $temporaryCsv) {
    $quarantine = Quarantine-OrDeleteTemporaryOutput -TemporaryPath $temporaryCsv -Directory $outputDirectory -RunId $runId
    if ($null -ne $quarantine) { [Console]::Error.WriteLine("Stopped. Non-empty output was quarantined at $quarantine. Do not retry or inspect it outside the offline validator.") }
  }
  throw
}
