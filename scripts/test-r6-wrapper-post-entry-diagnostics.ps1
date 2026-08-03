param(
  [Parameter(Mandatory = $true)]
  [string]$WrapperPath,
  [Parameter(Mandatory = $true)]
  [string]$RepositoryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$FailureCode) {
  if (-not $Condition) { throw $FailureCode }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('r6-wrapper-post-entry-' + [guid]::NewGuid().ToString('N'))
$oldLibrary = $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE
$oldTest = $env:R6_OPERATOR_LAUNCH_TEST_MODE
$oldInert = $env:R6_OPERATOR_LAUNCHER_INERT_TEST_MODE
$oldMarker = $env:R6_OPERATOR_LAUNCHER_ENTRY_MARKER_PATH
$oldDiagnostic = $env:R6_OPERATOR_LAUNCHER_WRAPPER_DIAGNOSTIC_PATH
$oldGitFixture = $env:R6_DETACHED_GIT_TEST_FIXTURE
$global:R6WrapperFunctionCounter = 0
$global:R6WrapperAliasCounter = 0

try {
  New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
  $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = '1'
  . $WrapperPath -ExecutionWorktree $RepositoryPath -ValidateOnly

  function global:git { $global:R6WrapperFunctionCounter += 1; throw 'R6_TEST_GIT_FUNCTION_SHADOW_CALLED' }
  Resolve-R6GitExecutable
  $functionResult = Invoke-GitLines $RepositoryPath @('rev-parse', 'HEAD')
  Assert-True ($global:R6WrapperFunctionCounter -eq 0) 'R6_TEST_GIT_FUNCTION_SHADOW_USED'
  Assert-True ($functionResult.ExitCode -eq 0 -and $functionResult.Lines.Count -eq 1) 'R6_TEST_GIT_FUNCTION_SHADOW_RESULT_INVALID'
  Remove-Item function:global:git -ErrorAction Stop

  function global:R6TestGitAliasTarget { $global:R6WrapperAliasCounter += 1; throw 'R6_TEST_GIT_ALIAS_SHADOW_CALLED' }
  Set-Alias -Name git -Value R6TestGitAliasTarget -Scope Global -Force
  $script:R6GitExePath = $null
  Resolve-R6GitExecutable
  $aliasResult = Invoke-GitLines $RepositoryPath @('rev-parse', 'HEAD')
  Assert-True ($global:R6WrapperAliasCounter -eq 0) 'R6_TEST_GIT_ALIAS_SHADOW_USED'
  Assert-True ($aliasResult.ExitCode -eq 0 -and $aliasResult.Lines.Count -eq 1) 'R6_TEST_GIT_ALIAS_SHADOW_RESULT_INVALID'
  Remove-Item alias:git -ErrorAction Stop
  Remove-Item function:global:R6TestGitAliasTarget -ErrorAction Stop

  foreach ($fixture in @{ NOT_FOUND = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_NOT_FOUND'; AMBIGUOUS = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_AMBIGUOUS'; NOT_APPLICATION = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_NOT_APPLICATION'; PATH_INVALID = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_PATH_INVALID' }.GetEnumerator()) {
    $env:R6_DETACHED_GIT_TEST_FIXTURE = $fixture.Key
    try { Resolve-R6GitExecutable; throw 'R6_TEST_GIT_FIXTURE_NOT_TRIGGERED' } catch { Assert-True ($_.Exception.Message -eq $fixture.Value) 'R6_TEST_GIT_FIXTURE_CLASSIFICATION_INVALID' }
  }
  Remove-Item Env:R6_DETACHED_GIT_TEST_FIXTURE -ErrorAction Stop

  $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = $null
  $env:R6_OPERATOR_LAUNCH_TEST_MODE = '1'
  $env:R6_OPERATOR_LAUNCHER_INERT_TEST_MODE = '1'
  foreach ($stage in @('MODE_RESOLUTION','FIXED_BINDING_VALIDATION','GIT_EXECUTABLE_RESOLUTION','DETACHED_WORKTREE_VALIDATION','BLOB_AND_RAW_HASH_VALIDATION','EVIDENCE_ROOT_VALIDATION','SECRET_ENVIRONMENT_GUARD','CAPTURE_COMMAND_PREPARATION')) {
    $marker = Join-Path $root ("entry-marker-$stage.json")
    $diagnostic = Join-Path $root ("diagnostic-$stage.json")
    $env:R6_OPERATOR_LAUNCHER_ENTRY_MARKER_PATH = $marker
    $env:R6_OPERATOR_LAUNCHER_WRAPPER_DIAGNOSTIC_PATH = $diagnostic
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $null = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $RepositoryPath -PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly -RunId 'qa-canary-00000000-0000-4000-8000-000000000097' -R6PostEntryTestFailpoint $stage -EvidenceRoot (Join-Path $root 'evidence') 2>$null
      $failpointExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorActionPreference }
    Assert-True ($failpointExitCode -ne 0) 'R6_TEST_POST_ENTRY_FAILPOINT_NOT_TRIGGERED'
    Assert-True (Test-Path -LiteralPath $marker -PathType Leaf) 'R6_TEST_POST_ENTRY_MARKER_MISSING'
    $value = Get-Content -LiteralPath $diagnostic -Raw | ConvertFrom-Json
    Assert-True ($value.wrapperStage -eq $stage) 'R6_TEST_POST_ENTRY_STAGE_INVALID'
    Assert-True ($value.wrapperInnerClassification -eq 'R6_DETACHED_SECURE_WRAPPER_POST_ENTRY_UNCLASSIFIED_FAILURE') 'R6_TEST_POST_ENTRY_CLASSIFICATION_INVALID'
    Assert-True ($value.PSObject.Properties.Name -notcontains 'message') 'R6_TEST_POST_ENTRY_RAW_MESSAGE_PERSISTED'
    Assert-True ($value.originalExceptionType -match '^[A-Za-z0-9_.+]{1,160}$') 'R6_TEST_POST_ENTRY_EXCEPTION_METADATA_INVALID'
  }
  $marker = Join-Path $root 'entry-marker-existing.json'
  $diagnostic = Join-Path $root 'diagnostic-existing.json'
  $env:R6_OPERATOR_LAUNCHER_ENTRY_MARKER_PATH = $marker
  $env:R6_OPERATOR_LAUNCHER_WRAPPER_DIAGNOSTIC_PATH = $diagnostic
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $null = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $WrapperPath -ExecutionWorktree $RepositoryPath -PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly -RunId 'qa-canary-00000000-0000-4000-8000-000000000097' -R6PostEntryTestExistingClassification R6_PREEXISTING_SECRET_ENV_DENIED -EvidenceRoot (Join-Path $root 'evidence') 2>$null
    $existingExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  Assert-True ($existingExitCode -ne 0) 'R6_TEST_PREEXISTING_CLASSIFICATION_NOT_TRIGGERED'
  $existing = Get-Content -LiteralPath $diagnostic -Raw | ConvertFrom-Json
  Assert-True ($existing.wrapperInnerClassification -eq 'R6_PREEXISTING_SECRET_ENV_DENIED') 'R6_TEST_PREEXISTING_CLASSIFICATION_NOT_PRESERVED'
  Write-Output 'R6_WRAPPER_POST_ENTRY_DIAGNOSTIC_FIXTURES_OK'
} finally {
  Remove-Item function:global:git -ErrorAction SilentlyContinue
  Remove-Item alias:git -ErrorAction SilentlyContinue
  Remove-Item function:global:R6TestGitAliasTarget -ErrorAction SilentlyContinue
  Remove-Variable -Name R6WrapperFunctionCounter -Scope Global -ErrorAction SilentlyContinue
  Remove-Variable -Name R6WrapperAliasCounter -Scope Global -ErrorAction SilentlyContinue
  if ($null -eq $oldLibrary) { Remove-Item Env:R6_DETACHED_TRANSPORT_LIBRARY_MODE -ErrorAction SilentlyContinue } else { $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = $oldLibrary }
  if ($null -eq $oldTest) { Remove-Item Env:R6_OPERATOR_LAUNCH_TEST_MODE -ErrorAction SilentlyContinue } else { $env:R6_OPERATOR_LAUNCH_TEST_MODE = $oldTest }
  if ($null -eq $oldInert) { Remove-Item Env:R6_OPERATOR_LAUNCHER_INERT_TEST_MODE -ErrorAction SilentlyContinue } else { $env:R6_OPERATOR_LAUNCHER_INERT_TEST_MODE = $oldInert }
  if ($null -eq $oldMarker) { Remove-Item Env:R6_OPERATOR_LAUNCHER_ENTRY_MARKER_PATH -ErrorAction SilentlyContinue } else { $env:R6_OPERATOR_LAUNCHER_ENTRY_MARKER_PATH = $oldMarker }
  if ($null -eq $oldDiagnostic) { Remove-Item Env:R6_OPERATOR_LAUNCHER_WRAPPER_DIAGNOSTIC_PATH -ErrorAction SilentlyContinue } else { $env:R6_OPERATOR_LAUNCHER_WRAPPER_DIAGNOSTIC_PATH = $oldDiagnostic }
  if ($null -eq $oldGitFixture) { Remove-Item Env:R6_DETACHED_GIT_TEST_FIXTURE -ErrorAction SilentlyContinue } else { $env:R6_DETACHED_GIT_TEST_FIXTURE = $oldGitFixture }
  if (Test-Path -LiteralPath $root -PathType Container) {
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\\') + '\\'
    $resolvedRoot = (Resolve-Path -LiteralPath $root -ErrorAction Stop).Path
    if ($resolvedRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedRoot) -match '^r6-wrapper-post-entry-[0-9a-f]{32}$') {
      Remove-Item -LiteralPath $resolvedRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
