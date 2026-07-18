[CmdletBinding()]
param(
  [string]$WrapperPath = $env:R6_CONSUMED_RUN_WRAPPER_PATH,
  [string]$ExecutionWorktree = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($WrapperPath)) { $WrapperPath = 'C:\Users\1\OpenGlassHub-R6-Proof\start-r6-detached-secure.ps1' }
if ([string]::IsNullOrWhiteSpace($ExecutionWorktree)) { $ExecutionWorktree = (Get-Location).Path }
if (-not (Test-Path -LiteralPath $WrapperPath -PathType Leaf)) { throw 'R6_WRAPPER_TEST_WRAPPER_MISSING' }
if (-not (Test-Path -LiteralPath $ExecutionWorktree -PathType Container)) { throw 'R6_WRAPPER_TEST_WORKTREE_MISSING' }

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Message) {
  if ($Actual -cne $Expected) { throw "R6_WRAPPER_TEST_ASSERTION_FAILED:$Message" }
}

function Invoke-WrapperCase([string]$Name, [int]$ExitCode, [string[]]$Stdout, [string[]]$Stderr, [string]$ExpectedClassification, [bool]$ExpectSuccess) {
  $evidence = Join-Path ([IO.Path]::GetTempPath()) ("r6-wrapper-output-" + [Guid]::NewGuid().ToString('N'))
  $script:FakeNodeExitCode = $ExitCode
  $script:FakeNodeStdout = @($Stdout)
  $script:FakeNodeStderr = @($Stderr)
  $script:FakeNodeCalls = 0
  $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = '1'
  try {
    . $WrapperPath -ExecutionWorktree $ExecutionWorktree -EvidenceRoot $evidence
    function global:node {
      param([Parameter(ValueFromRemainingArguments = $true)][object[]]$Arguments)
      $script:FakeNodeCalls += 1
      foreach ($line in $script:FakeNodeStdout) { Write-Output $line }
      foreach ($line in $script:FakeNodeStderr) { Write-Error $line }
      $global:LASTEXITCODE = $script:FakeNodeExitCode
    }
    $visible = @()
    $thrown = $null
    try { $visible = @(Invoke-PrepareAuthDryRunAttestation $ExecutionWorktree) }
    catch { $thrown = $_.Exception.Message }
    if ($script:FakeNodeCalls -ne 1) { throw "R6_WRAPPER_TEST_ASSERTION_FAILED:$Name fake-node-calls=$script:FakeNodeCalls terminal=$thrown" }
    if ($ExpectSuccess) {
      Assert-Equal $thrown $null "$Name must not throw"
      Assert-Equal $visible.Count 3 "$Name must emit exactly three ordered output lines"
      Assert-Equal $visible[0] 'R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION' "$Name must emit the stable success classification"
      Assert-Equal ($visible[1] -match '\-AuthCheckOnly\b') $true "$Name must emit AuthCheckOnly only"
      Assert-Equal ($visible[2] -match '\-DryRunOnly\b') $true "$Name must emit DryRunOnly only"
      Assert-Equal (($visible -join "`n") -match 'ExecuteApprovedPhase') $false "$Name must never emit a live command"
    } else {
      Assert-Equal $thrown $ExpectedClassification "$Name must fail with the stable classification"
      Assert-Equal $visible.Count 0 "$Name must not emit commands on failure"
      $failure = Join-Path $evidence 'metadata-preparation-failure.json'
      if (-not (Test-Path -LiteralPath $failure -PathType Leaf)) { throw "R6_WRAPPER_TEST_ASSERTION_FAILED:$Name must preserve sanitized failure evidence" }
      $raw = Get-Content -LiteralPath $failure -Raw
      Assert-Equal ($raw -match '(?i)(account[_-]?id|oauth[_-]?token|access[_-]?token|refresh[_-]?token|authorization|password)') $false "$Name evidence must be value blind"
    }
  } finally {
    Remove-Item -Path Function:\global:node -ErrorAction SilentlyContinue
    Remove-Item Env:R6_DETACHED_TRANSPORT_LIBRARY_MODE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $evidence -Force -Recurse -ErrorAction SilentlyContinue
  }
}

$success = 'R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION'
Invoke-WrapperCase 'oauth-not-ready' 1 @() @('R6_METADATA_PREPARATION_OAUTH_PROFILE_NOT_READY') 'R6_HARDENED_OFFICIAL_GET_OAUTH_NOT_READY' $false
Invoke-WrapperCase 'account-input-canceled' 1 @() @('R6_METADATA_PREPARATION_ACCOUNT_INPUT_FAILED') 'R6_HARDENED_OFFICIAL_GET_ACCOUNT_INPUT_FAILED' $false
Invoke-WrapperCase 'transport-failed' 1 @() @('PAGES_DEPLOYMENT_GET_AUTH_TRANSPORT_UNAVAILABLE') 'R6_HARDENED_OFFICIAL_GET_TRANSPORT_FAILED' $false
Invoke-WrapperCase 'target-mismatch' 1 @() @('PAGES_DEPLOYMENT_GET_TARGET_MISMATCH') 'R6_HARDENED_OFFICIAL_GET_TARGET_MISMATCH' $false
Invoke-WrapperCase 'attestation-failed' 1 @() @('R6_HARDENED_OFFICIAL_GET_ATTESTATION_SEAL_FAILED') 'R6_HARDENED_OFFICIAL_GET_ATTESTATION_FAILED' $false
Invoke-WrapperCase 'validate-only-failed' 1 @() @('R6_HARDENED_OFFICIAL_GET_VALIDATE_ONLY_FAILED') 'R6_HARDENED_OFFICIAL_GET_VALIDATE_ONLY_FAILED' $false
Invoke-WrapperCase 'node-nonzero-generic' 7 @() @('R6_SYNTHETIC_NODE_FAILURE') 'R6_HARDENED_OFFICIAL_GET_NODE_PROCESS_FAILED' $false
Invoke-WrapperCase 'empty-success-output' 0 @() @() 'R6_HARDENED_OFFICIAL_GET_EMPTY_OUTPUT_FAILED' $false
Invoke-WrapperCase 'missing-success-classification' 0 @('R6_OTHER_OUTPUT') @() 'R6_HARDENED_OFFICIAL_GET_EMPTY_OUTPUT_FAILED' $false
Invoke-WrapperCase 'full-fake-success' 0 @($success, "& 'C:\safe path\wrapper.ps1' -AuthCheckOnly", "& 'C:\safe path\wrapper.ps1' -DryRunOnly") @() '' $true

Write-Output 'R6_METADATA_WRAPPER_OUTPUT_CONTRACT_OK fake OAuth/account/transport/target/attestation/ValidateOnly/Node/empty/success paths emitted stable classifications with zero network, prompts, attestations, or run allocations'
