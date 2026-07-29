[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExecutionWorktree,
  [string]$WrapperPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourceWrapper = Join-Path $PSScriptRoot 'qa\r6-detached-secure-wrapper.ps1'
$renderer = Join-Path $PSScriptRoot 'qa\render-r6-detached-secure-wrapper.mjs'
$renderedWrapper = $null
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
    Require ($text -match [regex]::Escape($Expected)) ("R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_CLASSIFICATION_MISMATCH:${Kind}:$text")
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
function Invoke-AuthCheckFixture([bool]$MismatchAttestationSha = $false, [string]$FixtureKind = 'success') {
  $parent = Join-Path 'C:\Users\1\OpenGlassHub-R6-Proof\r6-current-canonical-production-v3-evidence' ('test-r6-v3-auth-' + [guid]::NewGuid().ToString())
  $child = Join-Path $parent 'auth-check'
  $attestationRoot = Join-Path ([IO.Path]::GetTempPath()) ('r6-v3-auth-attestations-' + [guid]::NewGuid().ToString())
  try {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    New-Item -ItemType Directory -Path $attestationRoot -Force | Out-Null
    $wrapperSha = (Get-FileHash -LiteralPath $WrapperPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $fixture = @(& node $fixtureGenerator '--root' $parent '--attestation-root' $attestationRoot '--tooling-commit' $script:V3Commit '--kind' 'authcheck-success' '--wrapper-path' $WrapperPath '--auth-root' $child '--wrapper-sha256' $wrapperSha 2>&1)
    Require ($LASTEXITCODE -eq 0 -and $fixture.Count -eq 1) 'R6_CURRENT_CANONICAL_V3_AUTH_FIXTURE_FAILED'
    $metadata = $fixture[0].ToString() | ConvertFrom-Json
    $capture = Get-Content -LiteralPath $metadata.terminalPath -Raw | ConvertFrom-Json
    $sha = [string]$capture.attestationSha256
    if ($MismatchAttestationSha) { $sha = '0' * 64 }
    $env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE = '1'
    $env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT = $metadata.attestationRoot
    $env:R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE = '1'
    $env:R6_V3_AUTH_FAILURE_FIXTURE_KIND = $FixtureKind
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE', '1', 'Process')
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT', $metadata.attestationRoot, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE', '1', 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_AUTH_FAILURE_FIXTURE_KIND', $FixtureKind, 'Process')
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $ExecutionWorktree -AuthCheckOnly -DeploymentAttestationPath $metadata.attestationPath -DeploymentAttestationSha256 $sha -EvidenceRoot $child 2>&1)
    $exitCode = $LASTEXITCODE; $ErrorActionPreference = $old
    $terminalPath = Join-Path $child 'auth-check-only-terminal-result.json'
    Require (Test-Path -LiteralPath $terminalPath -PathType Leaf) 'R6_CURRENT_CANONICAL_V3_AUTH_TERMINAL_MISSING'
    $terminal = Get-Content -LiteralPath $terminalPath -Raw | ConvertFrom-Json
    $validatorUrl = (Join-Path $PSScriptRoot 'qa\validate-r6-v3-auth-check-terminal.mjs').Replace('\', '/')
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $validated = @(& node --input-type=module -e "import { readFile } from 'node:fs/promises'; import { validateR6V3AuthCheckTerminal } from 'file:///$validatorUrl'; validateR6V3AuthCheckTerminal(JSON.parse(await readFile(process.argv[1], 'utf8'))); console.log('R6_V3_AUTH_CHECK_TERMINAL_OK');" $terminalPath 2>&1); $validationExit = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    Require ($validationExit -eq 0 -and $validated.Count -eq 1 -and $validated[0].ToString().Trim() -eq 'R6_V3_AUTH_CHECK_TERMINAL_OK') ("R6_CURRENT_CANONICAL_V3_AUTH_TERMINAL_VALIDATOR_FAILED:$($terminal.outerClassification):$($terminal.innerClassification):$($terminal.failureStage):$($terminal.exceptionType):worktree=$($terminal.worktreeValidationPassed):$($validated -join ',')")
    if ($MismatchAttestationSha) {
      Require ($exitCode -eq 1 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED' -and $terminal.innerClassification -eq 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ATTESTATION_SHA_MISMATCH' -and -not [bool]$terminal.captureProvenancePassed -and $terminal.failureStage -eq 'attestation_binding' -and -not [bool]$terminal.credentialPromptReached) 'R6_CURRENT_CANONICAL_V3_AUTH_SHA_MISMATCH_CONTRACT_FAILED'
    } elseif ($FixtureKind -eq 'success') {
      Require ($exitCode -eq 0 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK' -and [bool]$terminal.captureProvenancePassed -and $terminal.attestationType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V3' -and [int64]$terminal.remainingValidityMs -ge 720000 -and [bool]$terminal.credentialPromptReached -and [bool]$terminal.childStarted -and [bool]$terminal.success) ("R6_CURRENT_CANONICAL_V3_AUTH_SUCCESS_CONTRACT_FAILED:exit=${exitCode}:outer=$($terminal.outerClassification):inner=$($terminal.innerClassification):stage=$($terminal.failureStage):provenance=$($terminal.captureProvenancePassed):remaining=$($terminal.remainingValidityMs):child=$($terminal.childStarted):success=$($terminal.success)")
    } else {
      $expected = @{ dns='R6_AUTH_DNS_RESOLUTION_FAILED'; connection='R6_AUTH_CONNECTION_FAILED'; timeout='R6_AUTH_CONNECTION_TIMEOUT'; 'tls-trust'='R6_AUTH_TLS_NEGOTIATION_FAILED'; 'tls-channel'='R6_AUTH_TLS_NEGOTIATION_FAILED'; http400='R6_AUTH_HTTP_BAD_REQUEST'; 'http400-credential'='R6_AUTH_CREDENTIAL_REJECTED'; 'http400-email-confirmation'='R6_AUTH_EMAIL_CONFIRMATION_REQUIRED'; 'http400-account-disabled'='R6_AUTH_ACCOUNT_DISABLED_OR_BANNED'; 'http400-project-key'='R6_AUTH_PROJECT_OR_PUBLIC_KEY_REJECTED'; 'http400-verification'='R6_AUTH_VERIFICATION_REQUIRED'; 'http400-rate-limited'='R6_AUTH_RATE_LIMITED'; 'http400-temporary'='R6_AUTH_TEMPORARY_PROVIDER_REJECTION'; 'http400-malformed-json'='R6_AUTH_HTTP_BAD_REQUEST'; 'http400-empty'='R6_AUTH_HTTP_BAD_REQUEST'; http401='R6_AUTH_HTTP_UNAUTHORIZED'; http403='R6_AUTH_HTTP_FORBIDDEN'; http404='R6_AUTH_HTTP_NOT_FOUND'; http429='R6_AUTH_HTTP_RATE_LIMITED'; http500='R6_AUTH_HTTP_SERVER_ERROR'; http502='R6_AUTH_HTTP_SERVER_ERROR'; http503='R6_AUTH_HTTP_SERVER_ERROR'; http418='R6_AUTH_HTTP_OTHER_REJECTION'; malformed='R6_AUTH_RESPONSE_MALFORMED'; endpoint='R6_AUTH_ENDPOINT_BINDING_INVALID'; project='R6_AUTH_PROJECT_CONFIGURATION_INVALID'; unexpected='R6_AUTH_UNEXPECTED_FAILURE' }
      Require ($exitCode -eq 1 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED' -and $terminal.innerClassification -eq $expected[$FixtureKind] -and -not [bool]$terminal.success -and [bool]$terminal.authenticationStageReached -and -not [bool]$terminal.authenticationCompleted -and -not [bool]$terminal.sessionCreated -and -not [bool]$terminal.sessionValidated -and -not [bool]$terminal.authenticatedCheckReached -and -not [bool]$terminal.authenticatedCheckCompleted -and -not [bool]$terminal.childStarted -and [int]$terminal.supabaseWriteCount -eq 0 -and [int]$terminal.productionMutationCount -eq 0 -and $terminal.innerClassification -ne 'R6_AUTH_NETWORK_OR_REJECTED') ("R6_CURRENT_CANONICAL_V3_AUTH_FAILURE_CONTRACT_FAILED:${FixtureKind}:$($terminal.innerClassification):$($terminal.failureStage)")
      if ($FixtureKind -in @('endpoint','project')) { Require (-not [bool]$terminal.requestAttempted -and -not [bool]$terminal.requestDispatched -and -not [bool]$terminal.responseReceived) 'R6_CURRENT_CANONICAL_V3_AUTH_PRE_DISPATCH_CONTRACT_FAILED' }
      if ($FixtureKind -eq 'http401') { Require ([bool]$terminal.responseReceived -and [int]$terminal.httpStatusCode -eq 401 -and $terminal.providerReasonClass -eq 'credential_rejection' -and [bool]$terminal.providerReasonRecognized) 'R6_CURRENT_CANONICAL_V3_AUTH_HTTP_401_CONTRACT_FAILED' }
      if ($FixtureKind -in @('http400','http400-malformed-json','http400-empty','http418')) { Require (-not [bool]$terminal.providerReasonRecognized -and $terminal.providerReasonClass -in @('not_observed','provider_rejection_other')) 'R6_CURRENT_CANONICAL_V3_AUTH_PROVIDER_ALLOWLIST_CONTRACT_FAILED' }
      if ($FixtureKind -eq 'http400-credential') { Require ($terminal.providerReasonClass -eq 'credential_rejection' -and [bool]$terminal.providerReasonRecognized) 'R6_CURRENT_CANONICAL_V3_AUTH_CREDENTIAL_REJECTION_CONTRACT_FAILED' }
    }
  } finally {
    Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:R6_V3_AUTH_FAILURE_FIXTURE_KIND -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE', $null, 'Process')
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT', $null, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE', $null, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_AUTH_FAILURE_FIXTURE_KIND', $null, 'Process')
    Remove-Item -LiteralPath $parent -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $attestationRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-OrchestrationFixture([string]$Kind, [string]$NowUtc, [bool]$ExpectedSuccess) {
  $parent = Join-Path 'C:\Users\1\OpenGlassHub-R6-Proof\r6-current-canonical-production-v3-evidence' ('test-r6-v3-orchestration-' + [guid]::NewGuid().ToString())
  $attestationRoot = Join-Path ([IO.Path]::GetTempPath()) ('r6-v3-orchestration-attestations-' + [guid]::NewGuid().ToString())
  try {
    New-Item -ItemType Directory -Path $attestationRoot -Force | Out-Null
    $env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE = '1'
    $env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT = $attestationRoot
    $env:R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE = '1'
    $env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE = '1'
    $env:R6_V3_ORCHESTRATION_TEST_NOW_UTC = $NowUtc
    $env:R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR = $fixtureGenerator
    $env:R6_V3_ORCHESTRATION_WRAPPER_TEST_ORCHESTRATION_VALIDATOR = Join-Path $PSScriptRoot 'qa\validate-r6-v3-capture-auth-check-orchestration-terminal.mjs'
    $env:R6_V3_ORCHESTRATION_WRAPPER_TEST_AUTH_VALIDATOR = Join-Path $PSScriptRoot 'qa\validate-r6-v3-auth-check-terminal.mjs'
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE', '1', 'Process')
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT', $attestationRoot, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE', '1', 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE', '1', 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_TEST_NOW_UTC', $NowUtc, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR', $fixtureGenerator, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_WRAPPER_TEST_ORCHESTRATION_VALIDATOR', $env:R6_V3_ORCHESTRATION_WRAPPER_TEST_ORCHESTRATION_VALIDATOR, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_WRAPPER_TEST_AUTH_VALIDATOR', $env:R6_V3_ORCHESTRATION_WRAPPER_TEST_AUTH_VALIDATOR, 'Process')
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AndAuthCheckOnly -EvidenceRoot $parent -V3OrchestrationFixtureKind $Kind 2>&1)
    $exitCode = $LASTEXITCODE; $ErrorActionPreference = $old
    $terminalPath = Join-Path $parent 'capture-auth-check-orchestration-terminal-result.json'
    Require (Test-Path -LiteralPath $terminalPath -PathType Leaf) 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TERMINAL_MISSING'
    $terminal = Get-Content -LiteralPath $terminalPath -Raw | ConvertFrom-Json
    $validator = Join-Path $PSScriptRoot 'qa\validate-r6-v3-capture-auth-check-orchestration-terminal.mjs'
    $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $validated = @(& node $validator $terminalPath 2>&1); $validationExit = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    Require ($validationExit -eq 0 -and $validated.Count -eq 1 -and $validated[0].ToString().Trim() -eq 'R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_OK') ("R6_CURRENT_CANONICAL_V3_ORCHESTRATION_VALIDATOR_FAILED:" + ($validated -join '|'))
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    Require ($text -notmatch '\-AuthCheckOnly|\-DryRunOnly|qa-canary') 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_COMMAND_LEAK'
    Require (-not [bool]$terminal.dryRunStarted -and [int]$terminal.dryRunExecutionCount -eq 0 -and [int]$terminal.retryCount -eq 0 -and [int]$terminal.productionMutationCount -eq 0 -and [int]$terminal.supabaseWriteCount -eq 0) 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_SAFETY_CONTRACT_FAILED'
    if ($ExpectedSuccess) {
      Require ($exitCode -eq 0 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_CAPTURE_AND_AUTH_CHECK_ONLY_READY' -and [bool]$terminal.captureSuccess -and [bool]$terminal.authCheckStarted -and [bool]$terminal.authCheckSuccess -and [int64]$terminal.remainingValidityMs -ge 720000) ("R6_CURRENT_CANONICAL_V3_ORCHESTRATION_SUCCESS_CONTRACT_FAILED:exit=$exitCode:outer=$($terminal.outerClassification):inner=$($terminal.innerClassification):stage=$($terminal.failureStage):capture=$($terminal.captureSuccess):authStarted=$($terminal.authCheckStarted):authSuccess=$($terminal.authCheckSuccess):remaining=$($terminal.remainingValidityMs)")
    } else {
      Require ($exitCode -eq 1 -and -not [bool]$terminal.authCheckStarted -and -not [bool]$terminal.authCheckSuccess) 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_FAIL_CLOSED_CONTRACT_FAILED'
    }
  } finally {
    foreach ($name in @('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE','R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT','R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE','R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE','R6_V3_ORCHESTRATION_TEST_NOW_UTC','R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR','R6_V3_ORCHESTRATION_WRAPPER_TEST_ORCHESTRATION_VALIDATOR','R6_V3_ORCHESTRATION_WRAPPER_TEST_AUTH_VALIDATOR')) {
      Remove-Item ("Env:" + $name) -ErrorAction SilentlyContinue
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    Remove-Item -LiteralPath $parent -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $attestationRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ThreeStageOrchestrationFixture([string]$ReservationFailure = '', [string]$AuthFixtureKind = '', [string]$PreToolingFailure = '') {
  $parent = Join-Path 'C:\Users\1\OpenGlassHub-R6-Proof\r6-current-canonical-production-v3-evidence' ('test-r6-v3-three-stage-' + [guid]::NewGuid().ToString())
  $dryTerminalPath = Join-Path $parent 'dry-run\dry-run-only-terminal-result.json'
  $attestationRoot = Join-Path ([IO.Path]::GetTempPath()) ('r6-v3-three-stage-attestations-' + [guid]::NewGuid().ToString())
  try {
    New-Item -ItemType Directory -Path $attestationRoot -Force | Out-Null
    $settings = @{ R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE='1'; R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT=$attestationRoot; R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE='1'; R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE='1'; R6_V3_ORCHESTRATION_TEST_NOW_UTC='2099-01-01T00:03:00.000Z'; R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR=$fixtureGenerator; R6_V3_ORCHESTRATION_WRAPPER_TEST_AUTH_VALIDATOR=(Join-Path $PSScriptRoot 'qa\validate-r6-v3-auth-check-terminal.mjs'); R6_V3_ORCHESTRATION_WRAPPER_TEST_DRY_RUN_VALIDATOR=(Join-Path $PSScriptRoot 'qa\validate-r6-v3-dry-run-terminal.mjs'); R6_V3_ORCHESTRATION_WRAPPER_TEST_THREE_STAGE_VALIDATOR=(Join-Path $PSScriptRoot 'qa\validate-r6-v3-capture-authcheck-dryrun-orchestration-terminal.mjs') }
    foreach ($key in $settings.Keys) { [Environment]::SetEnvironmentVariable($key, [string]$settings[$key], 'Process') }
    if (-not [string]::IsNullOrWhiteSpace($ReservationFailure)) { [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_TEST_DRY_RUN_RESERVATION_FAILURE', $ReservationFailure, 'Process') }
    if (-not [string]::IsNullOrWhiteSpace($AuthFixtureKind)) { [Environment]::SetEnvironmentVariable('R6_V3_AUTH_FAILURE_FIXTURE_KIND', $AuthFixtureKind, 'Process') }
    if (-not [string]::IsNullOrWhiteSpace($PreToolingFailure)) { [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_TEST_DRY_RUN_PRE_TOOLING_FAILURE', $PreToolingFailure, 'Process') }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly -RunId 'qa-canary-11111111-1111-4111-8111-111111111111' -EvidenceRoot $parent 2>&1)
    $exitCode = $LASTEXITCODE; $ErrorActionPreference = $old
    $terminalPath = Join-Path $parent 'capture-authcheck-dryrun-orchestration-terminal-result.json'
    Require (Test-Path -LiteralPath $terminalPath -PathType Leaf) ('R6_CURRENT_CANONICAL_V3_THREE_STAGE_TERMINAL_MISSING:' + (($output | ForEach-Object { $_.ToString() }) -join '|'))
    $validator = Join-Path $PSScriptRoot 'qa\validate-r6-v3-capture-authcheck-dryrun-orchestration-terminal.mjs'; $validated = @(& node $validator $terminalPath 2>&1)
    Require ($LASTEXITCODE -eq 0 -and $validated.Count -eq 1 -and $validated[0].ToString().Trim() -eq 'R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_OK') 'R6_CURRENT_CANONICAL_V3_THREE_STAGE_VALIDATOR_FAILED'
    $terminal = Get-Content -LiteralPath $terminalPath -Raw | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace($AuthFixtureKind)) {
      $expectedAuthInner = if ($AuthFixtureKind -eq 'http400-credential') { 'R6_AUTH_CREDENTIAL_REJECTED' } else { 'R6_AUTH_HTTP_UNAUTHORIZED' }
      Require ($exitCode -eq 1 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_AUTH_CHECK_FAILED' -and $terminal.innerClassification -eq $expectedAuthInner -and $terminal.failureStage -eq 'AUTH_PASSWORD_GRANT_REQUEST' -and [bool]$terminal.captureSuccess -and [bool]$terminal.authCheckStarted -and [bool]$terminal.authCheckCompleted -and -not [bool]$terminal.authCheckSuccess -and -not [bool]$terminal.dryRunStarted -and -not [bool]$terminal.dryRunCompleted -and -not [bool]$terminal.dryRunSuccess -and -not (Test-Path -LiteralPath $dryTerminalPath)) 'R6_CURRENT_CANONICAL_V3_THREE_STAGE_AUTH_FAILURE_CONTRACT_FAILED'
    } elseif (-not [string]::IsNullOrWhiteSpace($PreToolingFailure)) {
      $dryTerminal = Get-Content -LiteralPath $dryTerminalPath -Raw | ConvertFrom-Json
      Require ($exitCode -eq 1 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED' -and $terminal.innerClassification -eq $PreToolingFailure -and $terminal.failureStage -eq 'authentication' -and [bool]$terminal.captureSuccess -and [bool]$terminal.authCheckSuccess -and [bool]$terminal.dryRunStarted -and [bool]$terminal.dryRunCompleted -and -not [bool]$terminal.dryRunSuccess -and $terminal.dryRunReceiptRunnerCommit -eq $terminal.executionCommit -and $null -eq $terminal.dryRunExpectedToolingCommit -and $dryTerminal.innerClassification -eq $PreToolingFailure -and $dryTerminal.failureStage -eq 'authentication' -and [bool]$dryTerminal.receiptCreated -and $dryTerminal.receiptState -eq 'PENDING' -and $dryTerminal.receiptRunnerCommit -eq $dryTerminal.executionCommit -and $null -eq $dryTerminal.expectedToolingCommit -and -not [bool]$dryTerminal.childStarted -and -not [bool]$dryTerminal.canaryChildStarted -and -not [bool]$dryTerminal.adapterReached -and -not [bool]$dryTerminal.journalCreated -and [int]$dryTerminal.actualMutationCount -eq 0 -and [int]$dryTerminal.supabaseWriteCount -eq 0 -and [int]$dryTerminal.productionMutationCount -eq 0) 'R6_CURRENT_CANONICAL_V3_THREE_STAGE_PRE_TOOLING_FAILURE_CONTRACT_FAILED'
    } elseif ([string]::IsNullOrWhiteSpace($ReservationFailure)) {
      Require ($exitCode -eq 0 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY' -and [bool]$terminal.captureSuccess -and [bool]$terminal.authCheckSuccess -and [bool]$terminal.dryRunSuccess -and [int]$terminal.dryRunActualMutationCount -eq 0 -and [int]$terminal.productionMutationCount -eq 0 -and [int]$terminal.retryCount -eq 0) ("R6_CURRENT_CANONICAL_V3_THREE_STAGE_SUCCESS_CONTRACT_FAILED:exit=$exitCode:outer=$($terminal.outerClassification):inner=$($terminal.innerClassification):stage=$($terminal.failureStage):capture=$($terminal.captureSuccess):auth=$($terminal.authCheckSuccess):dry=$($terminal.dryRunSuccess)")
    } else {
      $dryTerminal = Get-Content -LiteralPath (Join-Path $parent 'dry-run\\dry-run-only-terminal-result.json') -Raw | ConvertFrom-Json
      Require ($exitCode -eq 1 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED' -and $terminal.innerClassification -eq $ReservationFailure -and $terminal.failureStage -eq 'RUN_ID_RESERVATION' -and [bool]$terminal.captureSuccess -and [bool]$terminal.authCheckSuccess -and -not [bool]$terminal.dryRunSuccess -and $dryTerminal.innerClassification -eq $ReservationFailure -and $dryTerminal.failureStage -eq 'RUN_ID_RESERVATION' -and -not [bool]$dryTerminal.canaryChildStarted -and -not [bool]$dryTerminal.receiptCreated -and [int]$dryTerminal.actualMutationCount -eq 0) 'R6_CURRENT_CANONICAL_V3_THREE_STAGE_RESERVATION_FAILURE_CONTRACT_FAILED'
    }
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    Require ($text -notmatch '\-AuthCheckOnly|\-DryRunOnly|\-ExecuteApprovedPhase') 'R6_CURRENT_CANONICAL_V3_THREE_STAGE_COMMAND_LEAK'
  } finally {
    foreach ($name in @('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE','R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT','R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE','R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE','R6_V3_ORCHESTRATION_TEST_NOW_UTC','R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR','R6_V3_ORCHESTRATION_WRAPPER_TEST_AUTH_VALIDATOR','R6_V3_ORCHESTRATION_WRAPPER_TEST_DRY_RUN_VALIDATOR','R6_V3_ORCHESTRATION_WRAPPER_TEST_THREE_STAGE_VALIDATOR','R6_V3_ORCHESTRATION_TEST_DRY_RUN_RESERVATION_FAILURE','R6_V3_ORCHESTRATION_TEST_DRY_RUN_PRE_TOOLING_FAILURE','R6_V3_AUTH_FAILURE_FIXTURE_KIND')) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    Remove-Item -LiteralPath $parent -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $attestationRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  Require (Test-Path -LiteralPath $fixtureGenerator -PathType Leaf) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_MISSING'
  if ([string]::IsNullOrWhiteSpace($WrapperPath)) {
    Require (Test-Path -LiteralPath $renderer -PathType Leaf) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_RENDERER_MISSING'
    $head = @(& git -C $ExecutionWorktree rev-parse HEAD)
    Require ($LASTEXITCODE -eq 0 -and $head.Count -eq 1 -and $head[0] -match '^[a-f0-9]{40}$') 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_HEAD_INVALID'
    $renderedWrapper = Join-Path ([IO.Path]::GetTempPath()) ('r6-v3-rendered-wrapper-' + [guid]::NewGuid().ToString() + '.ps1')
    $render = @(& node $renderer --source $sourceWrapper --destination $renderedWrapper --worktree $ExecutionWorktree --v3-commit $head[0].Trim() 2>&1)
    Require ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $renderedWrapper -PathType Leaf)) 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_RENDER_FAILED'
    $WrapperPath = $renderedWrapper
  }
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
  Invoke-AuthCheckFixture
  Invoke-AuthCheckFixture $true
  foreach ($kind in @('dns','connection','timeout','tls-trust','tls-channel','http400','http400-credential','http400-email-confirmation','http400-account-disabled','http400-project-key','http400-verification','http400-rate-limited','http400-temporary','http400-malformed-json','http400-empty','http401','http403','http404','http429','http500','http502','http503','http418','malformed','endpoint','project','unexpected')) { Invoke-AuthCheckFixture $false $kind }
  Invoke-OrchestrationFixture 'authcheck-orchestration-success' '2099-01-01T00:03:00.000Z' $true
  Invoke-OrchestrationFixture 'authcheck-orchestration-success' '2099-01-01T00:03:00.001Z' $false
  Invoke-OrchestrationFixture 'target' '2099-01-01T00:03:00.000Z' $false
  Invoke-ThreeStageOrchestrationFixture
  Invoke-ThreeStageOrchestrationFixture 'R6_CONSUMED_RUN_TOOL_FAILED'
  Invoke-ThreeStageOrchestrationFixture '' '' 'R6_PROJECT_REF_INVALID'
  Invoke-ThreeStageOrchestrationFixture '' 'http400-credential'
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $mutual = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AuthDryRunAttestation -PreparePagesProjectR2AuthDryRunAttestation 2>&1); $mutualExit = $LASTEXITCODE; $ErrorActionPreference = $old
  Require ($mutualExit -eq 1 -and (($mutual | ForEach-Object { $_.ToString() }) -join "`n") -match 'R6_MODE_REQUIRED_EXACTLY_ONCE') 'R6_CURRENT_CANONICAL_V3_R2_MODE_REGRESSION'
  $wrapperText = Get-Content -LiteralPath $WrapperPath -Raw
  Require ((@([regex]::Matches($wrapperText, '\$PSCommandPath'))).Count -eq 1 -and $wrapperText -match '\$script:WrapperPath\s*=\s*\$PSCommandPath' -and $wrapperText -match 'function Reserve-ConsumedRun[\s\S]*Get-Sha256 \$script:WrapperPath') 'R6_CURRENT_CANONICAL_V3_WRAPPER_PATH_BINDING_REGRESSION'
  Require ($wrapperText -match 'function Invoke-PreparePagesProjectR2AuthDryRunAttestation' -and $wrapperText -match 'run-cloudflare-pages-project-r2-metadata-preparation\.mjs') 'R6_CURRENT_CANONICAL_V3_R2_PATH_REGRESSION'
  $captureRunnerText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'qa\run-cloudflare-pages-current-canonical-production-v3-preparation.mjs') -Raw
  Require ($wrapperText -match "'--command-output-mode','wrapper-buffered','--account-input-mode','wrapper-stdin'" -and $wrapperText -match 'Invoke-CurrentCanonicalProductionV3OAuthPreflight \$Validation' -and $wrapperText -match 'Invoke-CurrentCanonicalProductionV3RunnerWithHiddenAccountInput \$entrypoint \$arguments' -and $wrapperText -match 'Read-Host ''Cloudflare account ID \(hidden\)'' -AsSecureString' -and $wrapperText -match 'RedirectStandardInput = \$true' -and $wrapperText -notmatch '\$childOutput = @\(& node \$entrypoint' -and $wrapperText -match 'PrepareCurrentCanonicalProductionV3AndAuthCheckOnly' -and $wrapperText -match '\$null = Invoke-CurrentCanonicalProductionV3AuthCheckOnly') 'R6_CURRENT_CANONICAL_V3_CAPTURE_INPUT_TRANSPORT_REGRESSION'
  Require ($captureRunnerText -match 'R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PREFLIGHT_OPERATION' -and $captureRunnerText -match 'readWrapperProvidedCloudflareAccountId' -and $captureRunnerText -match 'values\.get\("--account-input-mode"\) !== "wrapper-stdin"' -and $captureRunnerText -match 'argv\.length === 2' -and $captureRunnerText -match 'R6_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PREFLIGHT_READY') 'R6_CURRENT_CANONICAL_V3_CAPTURE_TTY_OUTPUT_MODE_REGRESSION'
  Require ($wrapperText -match 'foreach \(\$key in \$parsed\.Keys\) \{ \$properties\[\[string\]\$key\] = \$parsed\[\$key\] \}' -and $wrapperText -match 'return \[pscustomobject\]\$properties') 'R6_CURRENT_CANONICAL_V3_PS51_JSON_NORMALIZATION_REGRESSION'
  Write-Output 'R6_CURRENT_CANONICAL_V3_WRAPPER_OK PowerShell-5.1 JSON normalization, OAuth-first hidden-account stdin transport, local fixtures, safe failures, impossible states, fingerprint guards, and R2-mode isolation passed with zero network'
} finally {
  Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT -ErrorAction SilentlyContinue
  if ($null -ne $renderedWrapper) { Remove-Item -LiteralPath $renderedWrapper -Force -ErrorAction SilentlyContinue }
}
