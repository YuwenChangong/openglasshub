$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "lib\operational-guardrails-authenticated-privilege-runner.ps1")
. (Join-Path $PSScriptRoot "lib\operational-guardrails-authenticated-privilege-native-runner.ps1")

function Assert-Throws {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [Parameter(Mandatory = $true)][string]$Pattern)
  try { & $Action } catch { if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected error: $($_.Exception.Message)" }; return }
  throw "Expected failure matching: $Pattern"
}

$aaaa = [pscustomobject]@{ Name = "db.example.test"; Type = "AAAA"; IPAddress = "2001:db8::1" }
if ((Assert-DirectDnsAaaaResults -ExpectedHost "db.example.test" -Results @($aaaa)).Count -ne 1) { throw "AAAA-only DNS result was not accepted" }
if ((Assert-DirectDnsAaaaResults -ExpectedHost "db.example.test" -Results @($aaaa, [pscustomobject]@{ Name = "db.example.test"; Type = "AAAA"; IPAddress = "2001:db8::2" })).Count -ne 2) { throw "multiple AAAA DNS results were not accepted" }
Assert-Throws -Action { Assert-DirectDnsAaaaResults -ExpectedHost "db.example.test" -Results @() } -Pattern 'no records'
Assert-Throws -Action { Assert-DirectDnsAaaaResults -ExpectedHost "db.example.test" -Results @([pscustomobject]@{ Name = "db.example.test"; Type = "A"; IPAddress = "192.0.2.1" }) } -Pattern 'no usable AAAA'
Assert-Throws -Action { Get-Postgres17ClientVersion -VersionLines @() } -Pattern 'returned 0 output lines'
Assert-Throws -Action { Get-Postgres17ClientVersion -VersionLines @('psql 17') } -Pattern 'could not be parsed'
if ((Get-Postgres17ClientVersion -VersionLines @('psql (PostgreSQL) 17.6')) -ne 'psql (PostgreSQL) 17.6') { throw 'PostgreSQL 17 version was not accepted' }
Assert-Throws -Action { Get-Postgres17ClientVersion -VersionLines @('psql (PostgreSQL) 16.9') } -Pattern 'major version must be 17'
Assert-Throws -Action { Get-NativePsqlPath -Commands @() } -Pattern 'install/configure a native PostgreSQL 17 client'
if ((Get-NativePsqlPath -Commands @([pscustomobject]@{ Source = "C:\\PostgreSQL\\17\\bin\\psql.exe" })) -notmatch 'psql\.exe$') { throw 'native psql path was not accepted' }
Assert-Throws -Action { Assert-NativeExitCode -CommandName 'psql.exe --version' -ExitCode 1 } -Pattern 'psql.exe --version failed with exit code 1'
Assert-Throws -Action { Assert-NativeIpv6Reachability -TcpTestSucceeded $false -ComputerHost "db.example.test" -Port "5432" } -Pattern 'restore native IPv6 connectivity'
Assert-WorktreeClean -StatusLines @()
Assert-Throws -Action { Assert-WorktreeClean -StatusLines @('?? "untracked"') } -Pattern 'untracked'
Assert-ExpectedGitRefs -ExpectedHead ('a' * 40) -Head ('a' * 40) -OriginHead ('a' * 40)
Assert-Throws -Action { Assert-ExpectedGitRefs -ExpectedHead ('a' * 40) -Head ('a' * 40) -OriginHead ('b' * 40) } -Pattern 'expected HEAD/origin'

$directory = Join-Path ([System.IO.Path]::GetTempPath()) ("openglass-native-psql-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $directory | Out-Null
try {
  $final = Join-Path $directory "final.csv"
  $temporary = New-ExclusiveTemporaryOutputFile -Directory $directory -RunId "success"
  [System.IO.File]::WriteAllText($temporary, "packet_version`nvalue")
  Move-ValidatedTemporaryOutput -TemporaryPath $temporary -FinalPath $final
  if (-not (Test-Path -LiteralPath $final)) { throw 'validated temporary output was not moved' }
  Assert-Throws -Action { Move-ValidatedTemporaryOutput -TemporaryPath $final -FinalPath $final } -Pattern 'already exists'
  $zero = New-ExclusiveTemporaryOutputFile -Directory $directory -RunId "zero"
  Assert-Throws -Action { Move-ValidatedTemporaryOutput -TemporaryPath $zero -FinalPath (Join-Path $directory "zero-final.csv") } -Pattern 'produced no CSV evidence'
  if ($null -ne (Quarantine-OrDeleteTemporaryOutput -TemporaryPath $zero -Directory $directory -RunId "zero")) { throw 'zero-byte temporary output was not deleted' }
  $partial = New-ExclusiveTemporaryOutputFile -Directory $directory -RunId "partial"
  [System.IO.File]::WriteAllText($partial, "partial")
  $quarantine = Quarantine-OrDeleteTemporaryOutput -TemporaryPath $partial -Directory $directory -RunId "partial"
  if (-not (Test-Path -LiteralPath $quarantine)) { throw 'non-empty temporary output was not quarantined' }
} finally {
  Remove-Item -LiteralPath $directory -Recurse -Force
}

$connectionCalled = $false
Assert-Throws -Action { Invoke-OnlyAfterPreflight -Preflight { throw 'preflight failed' } -Action { $script:connectionCalled = $true } } -Pattern 'preflight failed'
if ($connectionCalled) { throw 'connection action ran after failed preflight' }
Write-Output 'operational-guardrails authenticated privilege native runner tests: PASS'
