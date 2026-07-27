[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExecutionWorktree,
  [string]$WrapperPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourceWrapper = Join-Path $PSScriptRoot 'qa\r6-detached-secure-wrapper.ps1'
if ([string]::IsNullOrWhiteSpace($WrapperPath)) { $WrapperPath = $sourceWrapper }
$fixtureGenerator = Join-Path $PSScriptRoot 'test-r6-current-canonical-production-v3-wrapper-fixtures.mjs'
$originalLauncher = 'C:\Users\1\OpenGlassHub-R6-Proof\start-r6y-canary-codex.ps1'
$expectedLauncherSha = 'ea3ccf119d69a552cf7c945aa872fed4734ce4916095819734e1c1839b727e46'

function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
function Read-WrapperBinding([string]$Name) {
  $line = @((Select-String -LiteralPath $WrapperPath -Pattern ('\$script:' + [regex]::Escape($Name) + "\s*=\s*'([a-f0-9_]+)'") | Select-Object -First 1))
  Require ($line.Count -eq 1) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_BINDING_MISSING'
  return $line[0].Matches[0].Groups[1].Value
}
function Invoke-Fixture([string]$Kind, [string]$Expected, [string]$CandidateWrapper = $WrapperPath) {
  $root = Join-Path ([IO.Path]::GetTempPath()) ('r6-v3-wrapper-' + [guid]::NewGuid().ToString())
  try {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    $fixture = @(& node $fixtureGenerator '--root' $root '--tooling-commit' $script:V3Commit '--kind' $Kind 2>&1)
    Require ($LASTEXITCODE -eq 0 -and $fixture.Count -eq 1) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_FAILED'
    $metadata = $fixture[0].ToString() | ConvertFrom-Json
    $env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE = '1'
    $env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT = [string]$metadata.attestationRoot
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $CandidateWrapper -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AuthDryRunAttestation -EvidenceRoot $root -V3TerminalFixturePath ([string]$metadata.terminalPath) 2>&1)
    $exitCode = $LASTEXITCODE; $ErrorActionPreference = $old
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    Require ($text -match [regex]::Escape($Expected)) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_CLASSIFICATION_MISMATCH'
    if ($Expected -eq 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_SUCCESS') {
      Require ($exitCode -eq 0) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_SUCCESS_EXIT_MISMATCH'
      Require ($text -notmatch 'AuthCheckOnly|DryRunOnly|ExecuteApprovedPhase|http') 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_COMMAND_LEAK'
    } else { Require ($exitCode -eq 1) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FAILURE_EXIT_MISMATCH' }
  } finally {
    Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  }
}
function Invoke-CopiedWrapperMismatch([string]$Binding, [string]$Expected) {
  $copy = Join-Path ([IO.Path]::GetTempPath()) ('r6-v3-wrapper-copy-' + [guid]::NewGuid().ToString() + '.ps1')
  try {
    $source = Get-Content -LiteralPath $WrapperPath -Raw
    $replacement = if ($Binding -eq 'V3FinalCommitBinding') { '0' * 40 } elseif ($Binding -eq 'V3GitBlobBinding') { '0' * 40 } else { '0' * 64 }
    $current = if ($Binding -eq 'V3FinalCommitBinding') { $script:V3Commit } elseif ($Binding -eq 'V3GitBlobBinding') { $script:V3Blob } else { $script:V3Raw }
    $source = $source.Replace(('$script:' + $Binding + " = '$current'"), ('$script:' + $Binding + " = '$replacement'"))
    [IO.File]::WriteAllText($copy, $source, [Text.UTF8Encoding]::new($false))
    Invoke-Fixture 'success' $Expected $copy
  } finally { Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue }
}

try {
  Require (Test-Path -LiteralPath $fixtureGenerator -PathType Leaf) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_MISSING'
  $script:V3Commit = Read-WrapperBinding 'V3FinalCommitBinding'
  $script:V3Raw = Read-WrapperBinding 'V3RuntimeRawSha256Binding'
  $script:V3Blob = Read-WrapperBinding 'V3GitBlobBinding'
  Require ($script:V3Commit -match '^[a-f0-9]{40}$' -and $script:V3Raw -match '^[a-f0-9]{64}$' -and $script:V3Blob -match '^[a-f0-9]{40}$') 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_UNBOUND'
  Require ((Get-FileHash -LiteralPath $originalLauncher -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expectedLauncherSha) 'R6_CURRENT_CANONICAL_V3_ORIGINAL_LAUNCHER_MUTATED'
  Invoke-Fixture 'success' 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_SUCCESS'
  Invoke-Fixture 'target' 'R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_TARGET_MISMATCH'
  Invoke-Fixture 'source' 'R6_CURRENT_CANONICAL_PRODUCTION_SOURCE_COMMIT_MISMATCH'
  foreach ($kind in @('success-zero-commands','failure-two-commands','wrong-order','third-command','transport-without-sentinel','validate-without-attestation','expired-success','secret')) { Invoke-Fixture $kind 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  Invoke-CopiedWrapperMismatch 'V3FinalCommitBinding' 'R6_CURRENT_CANONICAL_V3_COMMIT_MISMATCH'
  Invoke-CopiedWrapperMismatch 'V3GitBlobBinding' 'R6_CURRENT_CANONICAL_V3_GIT_BLOB_MISMATCH'
  Invoke-CopiedWrapperMismatch 'V3RuntimeRawSha256Binding' 'R6_CURRENT_CANONICAL_V3_RUNTIME_RAW_SHA256_MISMATCH'
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $mutual = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AuthDryRunAttestation -PreparePagesProjectR2AuthDryRunAttestation 2>&1); $mutualExit = $LASTEXITCODE; $ErrorActionPreference = $old
  Require ($mutualExit -eq 1 -and (($mutual | ForEach-Object { $_.ToString() }) -join "`n") -match 'R6_MODE_REQUIRED_EXACTLY_ONCE') 'R6_CURRENT_CANONICAL_V3_R2_MODE_REGRESSION'
  $wrapperText = Get-Content -LiteralPath $WrapperPath -Raw
  Require ($wrapperText -match 'function Invoke-PreparePagesProjectR2AuthDryRunAttestation' -and $wrapperText -match 'run-cloudflare-pages-project-r2-metadata-preparation\.mjs') 'R6_CURRENT_CANONICAL_V3_R2_PATH_REGRESSION'
  Write-Output 'R6_CURRENT_CANONICAL_V3_WRAPPER_OK PowerShell-5.1 local fixtures, safe failures, impossible states, fingerprint guards, and R2-mode isolation passed with zero network'
} finally {
  Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT -ErrorAction SilentlyContinue
}
