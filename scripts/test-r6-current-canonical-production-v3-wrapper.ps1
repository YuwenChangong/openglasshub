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
function Invoke-AuthCheckFixture([bool]$MismatchAttestationSha = $false) {
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
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE', '1', 'Process')
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT', $metadata.attestationRoot, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE', '1', 'Process')
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
    } else {
      Require ($exitCode -eq 0 -and $terminal.outerClassification -eq 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK' -and [bool]$terminal.captureProvenancePassed -and $terminal.attestationType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V3' -and [int64]$terminal.remainingValidityMs -ge 720000 -and [bool]$terminal.credentialPromptReached -and [bool]$terminal.childStarted -and [bool]$terminal.success) ("R6_CURRENT_CANONICAL_V3_AUTH_SUCCESS_CONTRACT_FAILED:exit=${exitCode}:outer=$($terminal.outerClassification):inner=$($terminal.innerClassification):stage=$($terminal.failureStage):provenance=$($terminal.captureProvenancePassed):remaining=$($terminal.remainingValidityMs):child=$($terminal.childStarted):success=$($terminal.success)")
    }
  } finally {
    Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE', $null, 'Process')
    [Environment]::SetEnvironmentVariable('R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT', $null, 'Process')
    [Environment]::SetEnvironmentVariable('R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE', $null, 'Process')
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
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $mutual = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AuthDryRunAttestation -PreparePagesProjectR2AuthDryRunAttestation 2>&1); $mutualExit = $LASTEXITCODE; $ErrorActionPreference = $old
  Require ($mutualExit -eq 1 -and (($mutual | ForEach-Object { $_.ToString() }) -join "`n") -match 'R6_MODE_REQUIRED_EXACTLY_ONCE') 'R6_CURRENT_CANONICAL_V3_R2_MODE_REGRESSION'
  $wrapperText = Get-Content -LiteralPath $WrapperPath -Raw
  Require ($wrapperText -match 'function Invoke-PreparePagesProjectR2AuthDryRunAttestation' -and $wrapperText -match 'run-cloudflare-pages-project-r2-metadata-preparation\.mjs') 'R6_CURRENT_CANONICAL_V3_R2_PATH_REGRESSION'
  Write-Output 'R6_CURRENT_CANONICAL_V3_WRAPPER_OK PowerShell-5.1 local fixtures, safe failures, impossible states, fingerprint guards, and R2-mode isolation passed with zero network'
} finally {
  Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT -ErrorAction SilentlyContinue
  if ($null -ne $renderedWrapper) { Remove-Item -LiteralPath $renderedWrapper -Force -ErrorAction SilentlyContinue }
}
