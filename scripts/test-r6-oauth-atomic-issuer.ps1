$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$driver = Join-Path $PSScriptRoot 'qa\run-r6-v3-oauth-readiness-and-issue-dryrun.ps1'
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($driver, [ref]$tokens, [ref]$errors) | Out-Null
if (@($errors).Count -ne 0) { throw 'R6_OAUTH_ATOMIC_ISSUER_PARSER_INVALID' }

$source = [IO.File]::ReadAllText($driver)
foreach ($required in @(
  'Set-StrictMode -Version Latest',
  '$script:ParentStart=',
  '$script:AtomicSessionId=',
  '$script:HandoffNonce',
  'parentPowerShellPid=$PID',
  'parentPowerShellStartTime=$script:ParentStart',
  '$Node22Path $WranglerEntryPath login --browser true --scopes pages:write',
  '$Node22Path (Join-Path $PSScriptRoot ''issue-r6-v3-oauth-readiness-attestation.mjs'')',
  '$Node22Path (Join-Path $PSScriptRoot ''issue-r6-v3-operator-dryrun-package.mjs'')',
  '--handoff-nonce-stdin',
  '[Array]::Clear($nonceBytes,0,$nonceBytes.Length)'
)) {
  if (-not $source.Contains($required)) { throw 'R6_OAUTH_ATOMIC_ISSUER_CONTRACT_INVALID' }
}

foreach ($forbidden in @('Start-Process', 'oauthAttestation', 'Invoke-WebRequest', 'Invoke-RestMethod')) {
  if ($source.Contains($forbidden)) { throw 'R6_OAUTH_ATOMIC_ISSUER_CONTRACT_INVALID' }
}

if (@([regex]::Matches($source, [regex]::Escape('login --browser true --scopes pages:write'))).Count -ne 1) { throw 'R6_OAUTH_ATOMIC_ISSUER_LOGIN_COUNT_INVALID' }
if (@([regex]::Matches($source, [regex]::Escape('$script:HandoffNonce | & $Node22Path'))).Count -ne 2) { throw 'R6_OAUTH_ATOMIC_ISSUER_NONCE_HANDOFF_INVALID' }

Write-Host 'R6_OAUTH_ATOMIC_ISSUER_POWERSHELL51_CONTRACT_FIXTURE_OK'
