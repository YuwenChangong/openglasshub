[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [Alias('RunnerWorktree')]
  [string]$ExecutionWorktree,
  [Parameter(Mandatory = $false)]
  [string]$DeploymentAttestationPath,
  [Parameter(Mandatory = $false)]
  [string]$DeploymentAttestationSha256,
  [switch]$ValidateOnly,
  [switch]$AuthCheckOnly,
  [switch]$DryRunOnly,
  [switch]$ExecuteApprovedPhase,
  [switch]$PrepareAuthDryRunAttestation,
  [switch]$PreparePagesProjectAuthDryRunAttestation,
  [switch]$PreparePagesProjectR2AuthDryRunAttestation,
  [switch]$PrepareCurrentCanonicalProductionV3AuthDryRunAttestation,
  [switch]$PrepareCurrentCanonicalProductionV3AndAuthCheckOnly,
  [switch]$PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly,
  [switch]$PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight,
  [string]$V3TerminalFixturePath,
  [string]$V3OrchestrationFixtureKind,
  [string]$RunId,
  [string]$PhaseApproval,
  [string]$FinalAuthorizationBindingPath,
  [string]$FinalAuthorizationBindingSha256,
  [string]$FinalExecutionBindingPath,
  [string]$FinalExecutionBindingSha256,
  [string]$R6PostEntryTestFailpoint,
  [string]$R6PostEntryTestExistingClassification,
  [string]$EvidenceRoot = 'C:\Users\1\OpenGlassHub-R6-Proof\r6-detached-secure-input-transport'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:WrapperPath = $PSCommandPath
$script:R6GitExePath = $null
$script:R6WrapperStage = $null

$script:ExpectedExecutionWorktree = 'C:\Users\1\OpenGlassHub-R6-Proof\r6-project-canonical-url-remediation\execution-worktree'
$script:ExpectedRunnerCommit = '1d558a54d07a9f425b98e9bcab501b4e644b7ef6'
$script:ExpectedDeployedCommit = 'b9ec4a06fb4aa67d7963c5d53ccc91e5c3965ed6'
$script:ExpectedBaseUrl = 'https://openglasshub.pages.dev'
$script:ExpectedAttestationRoot = 'C:\Users\1\OpenGlassHub-R6-Proof\deployment-attestations'
$script:ExpectedTargetIdentityHash = '56ab40042e30af8ce68625abb05b8dcb3c248c39ea4b116844c2d868f5421a8f'
$script:ConsumedRunRegistryRoot = 'C:\Users\1\OpenGlassHub-R6-Proof\production-canary'
$script:ConsumedRunWrapperVersion = 'r6-consumed-run-wrapper-v1'
$script:ConsumedRunToolRelativePath = 'scripts\qa\reserve-production-minimal-canary-run.mjs'
# CONSUMED_RUN_REGISTRY_V1 is the sole run-ID source of truth. It returns
# QA_CANARY_RUN_ID_ALREADY_CONSUMED before attestation, credentials, or network.
$script:RunnerRelativePath = 'scripts\qa\run-production-minimal-canary.mjs'
$script:RunnerApproval = 'APPROVE_R6_HARDENED_WRITE_AHEAD_FRESH_ATTESTATION_AUTH_DRY_RUN_AND_CANARY_EXECUTION'
$script:FuturePhaseApproval = 'APPROVE_R6_HARDENED_WRITE_AHEAD_FRESH_ATTESTATION_AUTH_DRY_RUN_AND_CANARY_EXECUTION'
$script:MinimumAttestationValidityMilliseconds = 720000
$script:ChildProcessTimeoutMilliseconds = 30000
$script:V3FinalCommitBinding = '989ec80672b1b62861d55c39385d0f2a369f9ab5'
$script:V3RuntimeRawSha256Binding = '53b5e8dc693090fa7c460874c484bb09f7a7d94049d477eac401d51433c14cfd'
$script:V3GitBlobBinding = '5ce532ad04115738c5e79ab7ec020f31a23a9a64'
$script:V3RunnerRelativePath = 'scripts\qa\run-cloudflare-pages-current-canonical-production-v3-preparation.mjs'
$script:V3TerminalValidatorRelativePath = 'scripts\qa\validate-r6-current-canonical-production-v3-terminal.mjs'
$script:V3EvidenceRootBase = 'C:\Users\1\OpenGlassHub-R6-Proof\r6-current-canonical-production-v3-evidence'
$script:FinalExecutionBinding = $null
$script:ReviewedHashes = [ordered]@{
  'scripts\qa\run-production-minimal-canary.mjs' = 'ce1dc9227f8378e198c65151fb1ad679be595d482a97b65700b4ae37f1991a3c'
  'scripts\qa\production-minimal-canary-consumed-run-registry.mjs' = '703d6694dcb68d9628a3ea5cdcc6cd79364e167c8e21fe7d5ecbfff684daf538'
  'scripts\qa\reserve-production-minimal-canary-run.mjs' = 'ab6d32a1e396e14e0584199d406df9ddaa71fcf8c3220757498a53ca47b90973'
  'scripts\qa\backfill-production-minimal-canary-consumed-runs.mjs' = '66b2245bc626825750a77c17fd754bebc50a5daac7cf837e280b59f712cd7c8c'
  'scripts\qa\production-deployment-attestation.mjs' = 'f35eb392445d10fcbe9185ae07eec52c4344d08f6349b81cf25f692c0bbaf06e'
  'scripts\qa\production-minimal-canary-core.mjs' = 'b75daed9feac8a39bb395386b8ed1921f6483b77ec5ad68afc2b5d84b0a7e697'
  'scripts\qa\production-minimal-canary-journal.mjs' = '515a37de9f1cf6198b9072ff2753b519f8927f11b6c3a32ac7cfac695a00a7d5'
  'scripts\qa\production-minimal-canary-http-adapter.mjs' = 'b688330b91d718e13d88e875e4d6109786f1942d27de0cdd934c9a1bf4c61124'
  'scripts\qa\target-write-guard.mjs' = 'abb2444961fe32362fb10997414a1e2f65fc726ea1c0fca7d8c6658b12f94aef'
  'scripts\qa\r6-native-child-process.psm1' = '0000000000000000000000000000000000000000000000000000000000000000'
  'scripts\qa\run-destructive-qa.mjs' = 'a9d18dec75469e11fabb96ddb902cd8a4d3d9dc4d93c234cd92e8250ad38d3a2'
  # Metadata preparation binds only reviewed code. The CLI owns OAuth validation
  # and hidden account input after its pre-prompt readiness check succeeds.
  'scripts\qa\cloudflare-pages-account-resolver.mjs' = 'fc42791f39ebf0a11566788f6a33e496279330588406ab103fb29353f571e10e'
  'scripts\qa\cloudflare-pages-deployment-get.mjs' = '7bd90ed5ac2b62e10db6cbc8b91f5596b743b0dfb72aae63dc3f1ecacf6cd37a'
  'scripts\qa\cloudflare-pages-oauth-profile-readiness.mjs' = '2478e303e444b38859e4833ef6880bedfa09d09e4cf1a8529ff2b230d3160014'
  'scripts\qa\prepare-cloudflare-pages-deployment-get.mjs' = 'cb7179e2ab49bb0716860de232f57ef60becb7958cdb5888612718a18484a194'
  'scripts\qa\run-cloudflare-pages-metadata-preparation.mjs' = '45e14e7636b210d57e49ed0a97c835a690e1f16b3e403b34407a082acfde9815'
  'scripts\qa\cloudflare-pages-project-get.mjs' = 'c4a072aec5c58fe5461f071a562a7dff2842889e2e8956f2df3cc65315204fa8'
  'scripts\qa\prepare-cloudflare-pages-project-get.mjs' = 'd8672217f0a5fc12099d3a32e396aedc78bd35950011bb70b9335702fa56f853'
  'scripts\qa\run-cloudflare-pages-project-metadata-preparation.mjs' = 'f740f3ffccc54d3031306eda71869c979222dea04e86f4c76c87945187e7c7dd'
  'scripts\qa\validate-r6-pages-project-terminal-result.mjs' = '69c6845cdada1c2b8f864a5d858fdd3e73bf394c25efa72bfafc40b79d22b1e3'
  'scripts\qa\cloudflare-pages-project-r2-get.mjs' = '199cba16c13e2df8bb414dc9e2392640f5f4521c93c44626efb1b89faea8599d'
  'scripts\qa\prepare-cloudflare-pages-project-r2-get.mjs' = '9dfa0bc0cb5e15099ee5687f739deb4fac0e1fc6d73576761b799f57343cc328'
  'scripts\qa\run-cloudflare-pages-project-r2-metadata-preparation.mjs' = '3081a2dfedb934f6fca0a76a6fe10f231ab3f19a0709b9b2ce07e3581afb8ed5'
  'scripts\qa\validate-r6-pages-project-r2-terminal-result.mjs' = 'b6502411687803d4669c9e7985bab671df71c0c60804d860a34a5cff6b2ce7b0'
}
$script:ReviewedGitBlobHashes = [ordered]@{
  'scripts\qa\run-production-minimal-canary.mjs' = '76eca9a24dcfae34983500ddcce01b37dfd868f3'
  'scripts\qa\production-minimal-canary-consumed-run-registry.mjs' = '9117bffdc363aa6df454a89b0c55261e8c289952'
  'scripts\qa\reserve-production-minimal-canary-run.mjs' = 'c6cd8e2e21175aae754a5cdc06e85f8ebfa880ca'
  'scripts\qa\backfill-production-minimal-canary-consumed-runs.mjs' = 'd470aadf7f95eba8902734ddefc74208bbc67196'
  'scripts\qa\production-deployment-attestation.mjs' = '49ac95c96a540a2f3d7249e1b8327c0a8914b80f'
  'scripts\qa\production-minimal-canary-core.mjs' = '47214b99ff12daaa831cad1879258e91b0cc3083'
  'scripts\qa\production-minimal-canary-journal.mjs' = '767c5a7310724ea96acb43be56bf3023c99f646b'
  'scripts\qa\production-minimal-canary-http-adapter.mjs' = '1b6a4d18e4079988f3bfbac02e11db591905cf49'
  'scripts\qa\target-write-guard.mjs' = 'd23b0a231369a68ffe620683780e1db65c0eb7e7'
  'scripts\qa\r6-native-child-process.psm1' = '0000000000000000000000000000000000000000'
  'scripts\qa\run-destructive-qa.mjs' = '92803054bdab05de6a2c6926c733cd36489e6ae8'
  'scripts\qa\cloudflare-pages-account-resolver.mjs' = '3bf713b957a5962e381071d2cd6e7b14f4325663'
  'scripts\qa\cloudflare-pages-deployment-get.mjs' = 'cf0eebb233aa5fd21b268f2265a582abe2316f2c'
  'scripts\qa\cloudflare-pages-oauth-profile-readiness.mjs' = 'e12b9fa88b240d090434d1d84afd8a37d1cf2773'
  'scripts\qa\prepare-cloudflare-pages-deployment-get.mjs' = 'c0329209242a8ecffdfa6d66f1fbb7b45e22ec70'
  'scripts\qa\run-cloudflare-pages-metadata-preparation.mjs' = '41e2053a7a568c6fecbb6cf2eeb11d7ade8c6e36'
  'scripts\qa\cloudflare-pages-project-get.mjs' = '96e4037135ce4f81bab1984e4e1b1283d430a100'
  'scripts\qa\prepare-cloudflare-pages-project-get.mjs' = 'ff8d95cf1c6aa28e7c21e62e62b4bc88a85f5f9c'
  'scripts\qa\run-cloudflare-pages-project-metadata-preparation.mjs' = '7147229b645d47c98362010443db9e458e412bc6'
  'scripts\qa\validate-r6-pages-project-terminal-result.mjs' = '6c8d7c9fa4ebe4a6b18de9a5598e2da1d4b4fb8e'
  'scripts\qa\cloudflare-pages-project-r2-get.mjs' = 'b3f00e7d6d32b0d4210c890aca6f3cd76c38c2b8'
  'scripts\qa\prepare-cloudflare-pages-project-r2-get.mjs' = '867a29f3705379d5d0bd4a4cbb32337399cfe7f8'
  'scripts\qa\run-cloudflare-pages-project-r2-metadata-preparation.mjs' = '737a81c88f31264f6714aa5dcfdbd54e4ac41868'
  'scripts\qa\validate-r6-pages-project-r2-terminal-result.mjs' = '3b58c8054e8172b5feb83cb479fca5fc13075af7'
}
$script:SecretEnvironmentNames = @('QA_CANARY_ACCESS_TOKEN', 'QA_CANARY_SUPABASE_ANON_KEY')
$script:RunnerEnvironmentNames = @(
  'QA_SUPABASE_URL', 'QA_EXPECTED_SUPABASE_REF', 'QA_PRODUCTION_SUPABASE_REF',
  'QA_BASE_URL', 'QA_EXPECTED_RUNNER_COMMIT', 'QA_EXPECTED_DEPLOYED_COMMIT',
  'QA_DEPLOYMENT_ATTESTATION_PATH', 'QA_DEPLOYMENT_ATTESTATION_SHA256',
  'QA_CANARY_ACCESS_TOKEN', 'QA_CANARY_SUPABASE_ANON_KEY', 'QA_CANARY_TARGET_BINDING_PATH', 'QA_CANARY_REQUESTED_CIRCLE_SLUG',
  'QA_ALLOW_PRODUCTION_WRITES', 'QA_CANARY_APPROVAL', 'QA_CANARY_JOURNAL_ROOT',
  'QA_CANARY_CONSUMED_RUN_REGISTRY_ROOT', 'QA_CANARY_CONSUMED_RUN_RECEIPT_PATH',
  'QA_CANARY_CONSUMED_RUN_RECEIPT_SHA256', 'QA_CANARY_CONSUMED_RUN_NONCE',
  'QA_CANARY_WRAPPER_VERSION', 'QA_CANARY_WRAPPER_SHA256', 'QA_CANARY_CHILD_COMMAND_SHA256',
  'QA_EXPECTED_TOOLING_COMMIT', 'QA_CANARY_CHILD_TERMINAL_PATH'
)

function Get-Sha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "R6_REQUIRED_FILE_MISSING:$Path" }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Set-R6WrapperStage([string]$Stage) {
  $script:R6WrapperStage = $Stage
}

function Resolve-R6GitExecutable {
  $testFixture = [string]$env:R6_DETACHED_GIT_TEST_FIXTURE
  if (-not [string]::IsNullOrWhiteSpace($testFixture)) {
    if ($env:R6_DETACHED_TRANSPORT_LIBRARY_MODE -ne '1') { throw 'R6_DETACHED_SECURE_WRAPPER_GIT_TEST_FIXTURE_LIVE_REJECTED' }
    $fixtureCodes = @{
      NOT_FOUND = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_NOT_FOUND'
      AMBIGUOUS = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_AMBIGUOUS'
      NOT_APPLICATION = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_NOT_APPLICATION'
      PATH_INVALID = 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_PATH_INVALID'
    }
    if (-not $fixtureCodes.ContainsKey($testFixture)) { throw 'R6_DETACHED_SECURE_WRAPPER_GIT_TEST_FIXTURE_INVALID' }
    throw $fixtureCodes[$testFixture]
  }
  $commands = @(Get-Command 'git.exe' -CommandType Application -All -ErrorAction SilentlyContinue)
  if ($commands.Count -eq 0) { throw 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_NOT_FOUND' }
  if ($commands.Count -ne 1) { throw 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_AMBIGUOUS' }
  $command = $commands[0]
  if ($command.CommandType -ne [System.Management.Automation.CommandTypes]::Application) { throw 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_NOT_APPLICATION' }
  $candidate = [string]$command.Source
  if ([string]::IsNullOrWhiteSpace($candidate)) { $candidate = [string]$command.Path }
  if ([string]::IsNullOrWhiteSpace($candidate)) { throw 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_PATH_INVALID' }
  try { $candidate = [IO.Path]::GetFullPath($candidate) } catch { throw 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_PATH_INVALID' }
  if ((Split-Path -Leaf $candidate).ToLowerInvariant() -ne 'git.exe' -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_PATH_INVALID' }
  $script:R6GitExePath = $candidate
}

function Assert-R6GitExecutableResolved {
  if ([string]::IsNullOrWhiteSpace($script:R6GitExePath)) { throw 'R6_DETACHED_WRAPPER_GIT_EXECUTABLE_NOT_FOUND' }
}

function Invoke-GitLines([string]$Worktree, [string[]]$Arguments, [switch]$AllowFailure) {
  Assert-R6GitExecutableResolved
  $lines = @(& $script:R6GitExePath -C $Worktree @Arguments 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) { throw "R6_GIT_COMMAND_FAILED:$($Arguments -join ' ')" }
  return [pscustomobject]@{ Lines = @($lines | ForEach-Object { [string]$_ }); ExitCode = $exitCode }
}

function Assert-TranscriptSafe {
  # PowerShell exposes no portable, authoritative active-transcript query. Refuse only reliable indicators.
  $transcriptVariable = Get-Variable -Name Transcript -Scope Global -ErrorAction SilentlyContinue
  if ($null -ne $transcriptVariable -or -not [string]::IsNullOrWhiteSpace([string]$env:TRANSCRIPT)) {
    throw 'R6_ACTIVE_TRANSCRIPT_DETECTED'
  }
}

function Assert-NonBlank([string]$Value, [string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "R6_INPUT_REQUIRED:$Name" }
  return $Value.Trim()
}

function Write-OperatorLauncherAtomicMarker([string]$Path, [string]$Kind, [string]$Stage) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $full = [IO.Path]::GetFullPath($Path)
  $directory = Split-Path -Parent $full
  if ([string]::IsNullOrWhiteSpace($directory)) { throw 'R6_OPERATOR_LAUNCH_MARKER_PATH_INVALID' }
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $temporary = Join-Path $directory ('.' + [IO.Path]::GetFileName($full) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    $payload = [ordered]@{ schemaVersion='r6-v3-operator-launch-marker-v1'; kind=$Kind; stage=$Stage; createdAt=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($temporary, $payload, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $full -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
}

function Set-OperatorLauncherStage([string]$Stage) {
  Write-OperatorLauncherAtomicMarker $env:R6_OPERATOR_LAUNCHER_BREADCRUMB_PATH 'stage' $Stage
}

function Confirm-OperatorLauncherWrapperEntry {
  Write-OperatorLauncherAtomicMarker $env:R6_OPERATOR_LAUNCHER_ENTRY_MARKER_PATH 'wrapper-entry' 'INVOKE_WRAPPER_INLINE'
}

function Get-R6WrapperScriptPathClass([System.Management.Automation.ErrorRecord]$Record) {
  $path = [string]$Record.InvocationInfo.ScriptName
  if ([string]::IsNullOrWhiteSpace($path)) { return 'UNKNOWN' }
  if ($path -eq $script:WrapperPath) { return 'WRAPPER' }
  try {
    $root = [IO.Path]::GetFullPath($ExecutionWorktree).TrimEnd('\\') + '\\'
    $candidate = [IO.Path]::GetFullPath($path)
    if ($candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return 'REPOSITORY_SCRIPT' }
  } catch {}
  if ([IO.Path]::GetExtension($path).ToLowerInvariant() -eq '.exe') { return 'EXTERNAL_TOOL' }
  return 'UNKNOWN'
}

function Get-R6WrapperInvocationNameClass([System.Management.Automation.ErrorRecord]$Record) {
  $name = [string]$Record.InvocationInfo.InvocationName
  if ([string]::IsNullOrWhiteSpace($name)) { return 'UNKNOWN' }
  if ($name.Trim() -eq '&') { return 'CALL_OPERATOR' }
  if ($name -match '^(git|git\.exe|node|node\.exe)$') { return 'NATIVE_COMMAND' }
  if ($name -match '^[A-Za-z][A-Za-z0-9-]*$') { return 'POWERSHELL_FUNCTION' }
  return 'UNKNOWN'
}

function Write-R6WrapperPostEntryDiagnostic([System.Management.Automation.ErrorRecord]$Record, [string]$InnerClassification) {
  $path = [string]$env:R6_OPERATOR_LAUNCHER_WRAPPER_DIAGNOSTIC_PATH
  if ([string]::IsNullOrWhiteSpace($path)) { return }
  $temporary = $null
  try {
    $full = [IO.Path]::GetFullPath($path)
    $directory = Split-Path -Parent $full
    if ([string]::IsNullOrWhiteSpace($directory)) { return }
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $exceptionType = [string]$Record.Exception.GetType().FullName
    $fqid = [string]$Record.FullyQualifiedErrorId
    $category = [string]$Record.CategoryInfo.Category
    if ($exceptionType -notmatch '^[A-Za-z0-9_.+]{1,160}$') { $exceptionType = 'UNKNOWN' }
    if ($fqid -notmatch '^[A-Za-z0-9_.:-]{1,160}$') { $fqid = 'UNKNOWN' }
    if ($category -notmatch '^[A-Za-z]{1,80}$') { $category = 'UNKNOWN' }
    $payload = [ordered]@{
      schemaVersion = 'r6-wrapper-post-entry-diagnostic-v1'
      wrapperStage = $script:R6WrapperStage
      wrapperInnerClassification = $InnerClassification
      originalExceptionType = $exceptionType
      originalFullyQualifiedErrorId = $fqid
      originalCategory = $category
      originalScriptPathClass = Get-R6WrapperScriptPathClass $Record
      originalLine = [int]$Record.InvocationInfo.ScriptLineNumber
      originalColumn = [int]$Record.InvocationInfo.OffsetInLine
      originalInvocationNameClass = Get-R6WrapperInvocationNameClass $Record
    } | ConvertTo-Json -Compress
    $temporary = "$full.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($temporary, $payload, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $full -Force
  } catch {
    # Diagnostics are best effort and must never replace the original classification.
  } finally {
    if ($null -ne $temporary -and (Test-Path -LiteralPath $temporary)) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
  }
}

function Assert-ProjectRef([string]$Value) {
  $ref = Assert-NonBlank $Value 'production-project-ref'
  if ($ref -notmatch '^[a-z0-9]{6,64}$' -or $ref -match '(preview|local|localhost)') { throw 'R6_PROJECT_REF_INVALID' }
  return $ref.ToLowerInvariant()
}

function Assert-CircleSlug([string]$Value) {
  $slug = Assert-NonBlank $Value 'circle-slug'
  if ($slug -match '^[a-z][a-z0-9+.-]*://' -or $slug -match '[/?#]') { throw 'R6_CIRCLE_SLUG_INVALID' }
  return $slug
}

function Convert-SecureStringToPlaintext([System.Security.SecureString]$Value) {
  $bstr = [IntPtr]::Zero
  try {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
}

function Get-MetadataPreparationFailureClassification([string[]]$StdoutLines, [string[]]$StderrLines, [Nullable[int]]$ExitCode) {
  $allLines = @($StdoutLines + $StderrLines | ForEach-Object { [string]$_ }) -join "`n"
  if ($allLines -match 'R6_METADATA_PREPARATION_OAUTH|R6_OAUTH_PROFILE') { return 'R6_HARDENED_OFFICIAL_GET_OAUTH_NOT_READY' }
  if ($allLines -match 'R6_METADATA_PREPARATION_ACCOUNT|PAGES_ACCOUNT_ID') { return 'R6_HARDENED_OFFICIAL_GET_ACCOUNT_INPUT_FAILED' }
  if ($allLines -match 'TARGET_MISMATCH|DEPLOYMENT_ID_MISMATCH|PROJECT_MISMATCH|ENVIRONMENT_MISMATCH|ALIAS_MISMATCH|BRANCH_MISMATCH|COMMIT_MISMATCH') { return 'R6_HARDENED_OFFICIAL_GET_TARGET_MISMATCH' }
  if ($allLines -match 'ATTESTATION_SEAL|ATTESTATION_') { return 'R6_HARDENED_OFFICIAL_GET_ATTESTATION_FAILED' }
  if ($allLines -match 'VALIDATE_ONLY') { return 'R6_HARDENED_OFFICIAL_GET_VALIDATE_ONLY_FAILED' }
  if ($allLines -match 'MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ERR_UNKNOWN_FILE_EXTENSION|Cannot find module|Cannot use import statement|Unexpected token .export.') { return 'R6_HARDENED_OFFICIAL_GET_NODE_PROCESS_FAILED' }
  if ($allLines -match 'TRANSPORT|PAGES_DEPLOYMENT_GET|NETWORK') { return 'R6_HARDENED_OFFICIAL_GET_TRANSPORT_FAILED' }
  if ($null -eq $ExitCode -or $ExitCode -ne 0) { return 'R6_HARDENED_OFFICIAL_GET_NODE_PROCESS_FAILED' }
  return 'R6_HARDENED_OFFICIAL_GET_EMPTY_OUTPUT_FAILED'
}

function Write-MetadataPreparationFailureEvidence([string]$Classification, [Nullable[int]]$ExitCode, [string[]]$StdoutLines, [string[]]$StderrLines) {
  try {
    $exit = if ($null -eq $ExitCode) { 'unavailable' } else { [string]$ExitCode }
    Write-SanitizedEvidence $EvidenceRoot 'metadata-preparation-failure.json' ([ordered]@{
      mode = 'PrepareAuthDryRunAttestation'
      failureStage = 'node-terminal-evaluation'
      classification = $Classification
      nodeExitCode = $exit
      oauthValidationRan = 'not-observed'
      accountPromptRan = 'not-observed'
      requestSentinelReached = 'not-observed'
      transportExecuted = 'not-observed'
      stdoutLineCount = @($StdoutLines).Count
      stderrLineCount = @($StderrLines).Count
      rawTemporaryBytesRemoved = $true
      attestationArtifactsCreated = $false
      runArtifactsCreated = $false
      capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    }) | Out-Null
  } catch {
    # Evidence is best effort only; never conceal the stable terminal failure.
  }
}

function Invoke-PrepareAuthDryRunAttestation([string]$Worktree) {
  Assert-TranscriptSafe
  $transport = Get-Sha256 (Join-Path $Worktree 'scripts\qa\cloudflare-pages-deployment-get.mjs')
  $resolver = Get-Sha256 (Join-Path $Worktree 'scripts\qa\cloudflare-pages-account-resolver.mjs')
  $entrypoint = Join-Path $Worktree 'scripts\qa\run-cloudflare-pages-metadata-preparation.mjs'
  if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw 'R6_HARDENED_OFFICIAL_GET_NODE_ENTRYPOINT_LOAD_FAILED' }
  New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
  $terminalResultPath = Join-Path $EvidenceRoot 'metadata-preparation-terminal-result.json'
  if (Test-Path -LiteralPath $terminalResultPath) { throw 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID' }
  $arguments = @('--operation','PREPARE_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Worktree,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$EvidenceRoot,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$script:WrapperPath,'--execution-worktree',$Worktree,'--tooling-commit',$script:ExpectedRunnerCommit,'--wrapper-sha256',(Get-Sha256 $script:WrapperPath),'--transport-sha256',$transport,'--parser-selector-sha256',$resolver,'--deployment-id','6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a','--source-commit',$script:ExpectedDeployedCommit)
  $exitCode = $null
  try {
    Push-Location -LiteralPath $Worktree
    try {
      $previousErrorActionPreference = $ErrorActionPreference
      try {
        # Preserve the console for Node's non-echoing hidden prompt. The child writes
        # its terminal result through the one-shot restricted result file instead.
        $ErrorActionPreference = 'Continue'
        & node $entrypoint @arguments
        $exitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }
    } finally {
      Pop-Location
    }
  } finally { }
  if (-not (Test-Path -LiteralPath $terminalResultPath -PathType Leaf)) {
    $classification = 'R6_HARDENED_OFFICIAL_GET_RESULT_MISSING'
    Write-MetadataPreparationFailureEvidence $classification $exitCode @() @()
    throw $classification
  }
  try { $terminalResult = Get-Content -LiteralPath $terminalResultPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop }
  catch { Write-MetadataPreparationFailureEvidence 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID' $exitCode @() @(); throw 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID' }
  if ($terminalResult.schemaVersion -ne 'r6-metadata-preparation-terminal-result-v1' -or $terminalResult.toolingCommit -ne $script:ExpectedRunnerCommit -or $terminalResult.sanitizedEvidencePath -ne $terminalResultPath -or [string]$terminalResult.resultSha256 -notmatch '^[a-f0-9]{64}$' -or @($terminalResult.commands).Count -ne [int]$terminalResult.commandsEmittedCount) {
    Write-MetadataPreparationFailureEvidence 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID' $exitCode @() @()
    throw 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID'
  }
  if ($null -eq $exitCode -or $exitCode -ne [int]$terminalResult.childExitCode -or $exitCode -ne 0 -or $terminalResult.outerClassification -ne 'R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION') {
    $classification = if ($exitCode -eq 0) { 'R6_HARDENED_OFFICIAL_GET_EMPTY_OUTPUT_FAILED' } else { 'R6_HARDENED_OFFICIAL_GET_CHILD_PROCESS_FAILED' }
    Write-MetadataPreparationFailureEvidence $classification $exitCode @() @()
    throw $classification
  }
  $expectedClassification = 'R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION'
  $commands = @($terminalResult.commands | ForEach-Object { [string]$_ })
  if ($commands.Count -ne 2 -or $commands[0] -notmatch '\-AuthCheckOnly\b' -or $commands[1] -notmatch '\-DryRunOnly\b' -or ($commands -join "`n") -match 'ExecuteApprovedPhase') {
    Write-MetadataPreparationFailureEvidence 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID' $exitCode @() @()
    throw 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID'
  }
  Write-Output $expectedClassification
  $commands | ForEach-Object { Write-Output $_ }
}

function Invoke-PreparePagesProjectAuthDryRunAttestation([string]$Worktree) {
  Assert-TranscriptSafe
  $transport = Get-Sha256 (Join-Path $Worktree 'scripts\qa\cloudflare-pages-project-get.mjs')
  $parserSelector = Get-Sha256 (Join-Path $Worktree 'scripts\qa\cloudflare-pages-project-get.mjs')
  $entrypoint = Join-Path $Worktree 'scripts\qa\run-cloudflare-pages-project-metadata-preparation.mjs'
  $terminalValidator = Join-Path $Worktree 'scripts\qa\validate-r6-pages-project-terminal-result.mjs'
  if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw 'R6_PAGES_PROJECT_ENTRYPOINT_UNSAFE' }
  if (-not (Test-Path -LiteralPath $terminalValidator -PathType Leaf)) { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
  $terminalResultPath = Join-Path $EvidenceRoot 'project-metadata-preparation-terminal-result.json'
  if (Test-Path -LiteralPath $terminalResultPath) { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  $arguments = @('--operation','PREPARE_PROJECT_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Worktree,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$EvidenceRoot,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$script:WrapperPath,'--execution-worktree',$Worktree,'--tooling-commit',$script:ExpectedRunnerCommit,'--wrapper-sha256',(Get-Sha256 $script:WrapperPath),'--transport-sha256',$transport,'--parser-selector-sha256',$parserSelector)
  $exitCode = $null
  Push-Location -LiteralPath $Worktree
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      # The child owns the only inherited-TTY account prompt. Never capture or redirect it.
      $ErrorActionPreference = 'Continue'
      & node $entrypoint @arguments
      $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorActionPreference }
  } finally { Pop-Location }
  if (-not (Test-Path -LiteralPath $terminalResultPath -PathType Leaf)) { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  try { $terminalResult = Get-Content -LiteralPath $terminalResultPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  if ($terminalResult.schemaVersion -ne 'r6-pages-project-metadata-terminal-result-v1' -or $terminalResult.toolingCommit -ne $script:ExpectedRunnerCommit -or $terminalResult.sanitizedEvidencePath -ne $terminalResultPath -or [string]$terminalResult.resultSha256 -notmatch '^[a-f0-9]{64}$' -or @($terminalResult.commands).Count -ne [int]$terminalResult.commandsEmittedCount) { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  $validatorLines = @(& node $terminalValidator '--terminal-result-path' $terminalResultPath '--tooling-commit' $script:ExpectedRunnerCommit 2>&1)
  $validatorExitCode = $LASTEXITCODE
  if ($validatorExitCode -ne 0 -or $validatorLines.Count -ne 1 -or $validatorLines[0].ToString().Trim() -notmatch '^R6_PAGES_PROJECT_TERMINAL_RESULT_(SUCCESS|FAILURE)$') { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  if ($null -eq $exitCode -or $exitCode -ne [int]$terminalResult.childExitCode) { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  if ($validatorLines[0].ToString().Trim() -eq 'R6_PAGES_PROJECT_TERMINAL_RESULT_FAILURE') {
    if ($exitCode -ne 1 -or $terminalResult.commandsEmittedCount -ne 0) { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
    throw ([string]$terminalResult.outerClassification)
  }
  if ($exitCode -ne 0 -or $terminalResult.outerClassification -ne 'R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION') { throw 'R6_PAGES_PROJECT_TERMINAL_RESULT_UNSAFE' }
  $commands = @($terminalResult.commands | ForEach-Object { [string]$_ })
  if ($commands.Count -ne 2 -or $commands[0] -notmatch '\-AuthCheckOnly\b' -or $commands[1] -notmatch '\-DryRunOnly\b' -or ($commands -join "`n") -match 'ExecuteApprovedPhase|Prepare') { throw 'R6_PAGES_PROJECT_COMMAND_EMISSION_FAILED' }
  Write-Output 'R6_HARDENED_AUTH_AND_DRY_RUN_ATTESTATION_READY_FOR_HUMAN_EXECUTION'
  $commands | ForEach-Object { Write-Output $_ }
}

function Invoke-PreparePagesProjectR2AuthDryRunAttestation([string]$Worktree) {
  Assert-TranscriptSafe
  $transport = Get-Sha256 (Join-Path $Worktree 'scripts\qa\cloudflare-pages-project-r2-get.mjs')
  $parserSelector = Get-Sha256 (Join-Path $Worktree 'scripts\qa\cloudflare-pages-project-r2-get.mjs')
  $entrypoint = Join-Path $Worktree 'scripts\qa\run-cloudflare-pages-project-r2-metadata-preparation.mjs'
  $terminalValidator = Join-Path $Worktree 'scripts\qa\validate-r6-pages-project-r2-terminal-result.mjs'
  if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw 'R6_PAGES_PROJECT_R2_ENTRYPOINT_UNSAFE' }
  if (-not (Test-Path -LiteralPath $terminalValidator -PathType Leaf)) { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
  $terminalResultPath = Join-Path $EvidenceRoot 'project-r2-metadata-preparation-terminal-result.json'
  if (Test-Path -LiteralPath $terminalResultPath) { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  $arguments = @('--operation','PREPARE_PROJECT_R2_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Worktree,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$EvidenceRoot,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$script:WrapperPath,'--execution-worktree',$Worktree,'--tooling-commit',$script:ExpectedRunnerCommit,'--wrapper-sha256',(Get-Sha256 $script:WrapperPath),'--transport-sha256',$transport,'--parser-selector-sha256',$parserSelector)
  $exitCode = $null
  Push-Location -LiteralPath $Worktree
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      # The child owns the only inherited-TTY account prompt. Never capture or redirect it.
      $ErrorActionPreference = 'Continue'
      & node $entrypoint @arguments
      $exitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorActionPreference }
  } finally { Pop-Location }
  if (-not (Test-Path -LiteralPath $terminalResultPath -PathType Leaf)) { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  try { $terminalResult = Get-Content -LiteralPath $terminalResultPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  if ($terminalResult.schemaVersion -ne 'r6-pages-project-r2-metadata-terminal-result-v1' -or $terminalResult.toolingCommit -ne $script:ExpectedRunnerCommit -or $terminalResult.sanitizedEvidencePath -ne $terminalResultPath -or [string]$terminalResult.resultSha256 -notmatch '^[a-f0-9]{64}$' -or @($terminalResult.commands).Count -ne [int]$terminalResult.commandsEmittedCount) { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  $validatorLines = @(& node $terminalValidator '--terminal-result-path' $terminalResultPath '--tooling-commit' $script:ExpectedRunnerCommit 2>&1)
  $validatorExitCode = $LASTEXITCODE
  if ($validatorExitCode -ne 0 -or $validatorLines.Count -ne 1 -or $validatorLines[0].ToString().Trim() -notmatch '^R6_PAGES_PROJECT_R2_TERMINAL_RESULT_(SUCCESS|FAILURE)$') { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  if ($null -eq $exitCode -or $exitCode -ne [int]$terminalResult.childExitCode) { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  if ($validatorLines[0].ToString().Trim() -eq 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_FAILURE') {
    if ($exitCode -ne 1 -or $terminalResult.commandsEmittedCount -ne 0) { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
    throw ([string]$terminalResult.outerClassification)
  }
  if ($exitCode -ne 0 -or $terminalResult.outerClassification -ne 'R6_HARDENED_PAGES_PROJECT_R2_CAPTURE_HUMAN_COMMAND_READY') { throw 'R6_PAGES_PROJECT_R2_TERMINAL_RESULT_UNSAFE' }
  $commands = @($terminalResult.commands | ForEach-Object { [string]$_ })
  if ($commands.Count -ne 2 -or $commands[0] -notmatch '\-AuthCheckOnly\b' -or $commands[1] -notmatch '\-DryRunOnly\b' -or ($commands -join "`n") -match 'ExecuteApprovedPhase|Prepare') { throw 'R6_PAGES_PROJECT_R2_COMMAND_EMISSION_FAILED' }
  Write-Output 'R6_HARDENED_PAGES_PROJECT_R2_CAPTURE_HUMAN_COMMAND_READY'
  $commands | ForEach-Object { Write-Output $_ }
}

function Assert-CurrentCanonicalProductionV3Bindings {
  foreach ($binding in @($script:V3FinalCommitBinding, $script:V3RuntimeRawSha256Binding, $script:V3GitBlobBinding)) {
    if ([string]::IsNullOrWhiteSpace($binding)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_FINGERPRINT_UNBOUND' }
  }
  if ($script:V3FinalCommitBinding -notmatch '^[a-f0-9]{40}$' -or $script:V3RuntimeRawSha256Binding -notmatch '^[a-f0-9]{64}$' -or $script:V3GitBlobBinding -notmatch '^[a-f0-9]{40}$') { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_FINGERPRINT_INVALID' }
}

function Assert-CurrentCanonicalProductionV3ExecutionWorktree([string]$Worktree) {
  Set-R6WrapperStage 'DETACHED_WORKTREE_VALIDATION'
  if ([string]::IsNullOrWhiteSpace($Worktree) -or -not (Test-Path -LiteralPath $Worktree -PathType Container)) { throw 'R6_CURRENT_CANONICAL_V3_WORKTREE_MISSING' }
  $resolved = (Resolve-Path -LiteralPath $Worktree -ErrorAction Stop).Path
  $head = Invoke-GitLines $resolved @('rev-parse', 'HEAD')
  if ($head.Lines.Count -ne 1 -or $head.Lines[0].Trim().ToLowerInvariant() -ne $script:V3FinalCommitBinding) { throw 'R6_CURRENT_CANONICAL_V3_COMMIT_MISMATCH' }
  $symbolic = Invoke-GitLines $resolved @('symbolic-ref', '-q', 'HEAD') -AllowFailure
  if ($symbolic.ExitCode -eq 0) { throw 'R6_CURRENT_CANONICAL_V3_WORKTREE_NOT_DETACHED' }
  $status = Invoke-GitLines $resolved @('status', '--porcelain=v1')
  if ($status.Lines.Count -ne 0) { throw "R6_CURRENT_CANONICAL_V3_WORKTREE_DIRTY:$($status.Lines -join '|')" }
  $runner = Join-Path $resolved $script:V3RunnerRelativePath
  $validator = Join-Path $resolved $script:V3TerminalValidatorRelativePath
  if (-not (Test-Path -LiteralPath $runner -PathType Leaf) -or -not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_RUNTIME_FILE_MISSING' }
  Set-R6WrapperStage 'BLOB_AND_RAW_HASH_VALIDATION'
  $relative = $script:V3RunnerRelativePath.Replace('\', '/')
  $blob = Invoke-GitLines $resolved @('rev-parse', "$($script:V3FinalCommitBinding):$relative")
  if ($blob.Lines.Count -ne 1 -or $blob.Lines[0].Trim().ToLowerInvariant() -ne $script:V3GitBlobBinding) { throw 'R6_CURRENT_CANONICAL_V3_GIT_BLOB_MISMATCH' }
  $headBlob = Invoke-GitLines $resolved @('rev-parse', "HEAD:$relative")
  if ($headBlob.Lines.Count -ne 1 -or $headBlob.Lines[0].Trim().ToLowerInvariant() -ne $script:V3GitBlobBinding) { throw 'R6_CURRENT_CANONICAL_V3_RUNTIME_GIT_BLOB_MISMATCH' }
  if ((Get-Sha256 $runner) -ne $script:V3RuntimeRawSha256Binding) { throw 'R6_CURRENT_CANONICAL_V3_RUNTIME_RAW_SHA256_MISMATCH' }
  return [pscustomobject]@{ Path = $resolved; Head = $script:V3FinalCommitBinding; Runner = $runner; Validator = $validator }
}

function Assert-CurrentCanonicalProductionV3EvidenceRoot([string]$Root) {
  if (-not (Test-WindowsFullyQualifiedPath $Root)) { throw 'R6_CURRENT_CANONICAL_V3_EVIDENCE_ROOT_INVALID' }
  $base = [IO.Path]::GetFullPath($script:V3EvidenceRootBase)
  $candidate = [IO.Path]::GetFullPath($Root)
  if (-not (Test-PathContainedWithin $base $candidate) -or (Test-Path -LiteralPath $candidate)) { throw 'R6_CURRENT_CANONICAL_V3_EVIDENCE_ROOT_UNSAFE' }
  return $candidate
}

function Test-CurrentCanonicalProductionV3DownstreamRoot([string]$Mode, [string]$Root) {
  if ($Mode -notin @('AuthCheckOnly','DryRunOnly') -or -not (Test-WindowsFullyQualifiedPath $Root)) { return $false }
  $candidate = [IO.Path]::GetFullPath($Root)
  $base = [IO.Path]::GetFullPath($script:V3EvidenceRootBase)
  if (-not (Test-PathContainedWithin $base $candidate)) { return $false }
  $leaf = Split-Path -Leaf $candidate
  return ($Mode -eq 'AuthCheckOnly' -and $leaf -eq 'auth-check') -or ($Mode -eq 'DryRunOnly' -and $leaf -eq 'dry-run')
}

function Get-CurrentCanonicalProductionV3DownstreamParent([string]$Mode, [string]$Root) {
  if (-not (Test-CurrentCanonicalProductionV3DownstreamRoot $Mode $Root)) { throw 'R6_CURRENT_CANONICAL_V3_DOWNSTREAM_EVIDENCE_ROOT_REJECTED' }
  $candidate = [IO.Path]::GetFullPath($Root)
  $parent = Split-Path -Parent $candidate
  if (-not (Test-Path -LiteralPath $parent -PathType Container) -or (Test-Path -LiteralPath $candidate)) { throw 'R6_CURRENT_CANONICAL_V3_DOWNSTREAM_EVIDENCE_ROOT_REJECTED' }
  $terminal = Join-Path $parent 'current-canonical-production-v3-metadata-preparation-terminal-result.json'
  # The child terminal must record a missing parent terminal as a classified
  # provenance failure, so only derive the exact path here.
  return [pscustomobject]@{ Root = $candidate; Parent = $parent; CaptureTerminal = $terminal }
}

function Get-ValueBlindFailureCode([object]$ErrorRecord, [string]$Fallback) {
  foreach ($value in @([string]$ErrorRecord.Exception.Message, [string]$ErrorRecord.FullyQualifiedErrorId, [string]$ErrorRecord)) {
    if ($value -match '(QA_CANARY_[A-Z0-9_]+|R6_[A-Z0-9_]+)') { return $Matches[1] }
  }
  return $Fallback
}

function Convert-StrictUtcTimestamp([string]$Value, [string]$FailureCode) {
  if ($Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$') { throw $FailureCode }
  try {
    return ([DateTimeOffset]::Parse(
      $Value,
      [Globalization.CultureInfo]::InvariantCulture,
      ([Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
    )).ToUniversalTime()
  } catch { throw $FailureCode }
}

function Format-StrictUtcTimestamp([DateTimeOffset]$Value) {
  return $Value.ToUniversalTime().UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
}

function Get-CurrentCanonicalProductionV3UtcNow {
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') {
    $value = [string]$env:R6_V3_ORCHESTRATION_TEST_NOW_UTC
    return Convert-StrictUtcTimestamp $value 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TEST_CLOCK_INVALID'
  }
  return [DateTimeOffset]::UtcNow
}

function Invoke-CurrentCanonicalProductionV3OAuthPreflight([pscustomobject]$Validation) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = @(& node $Validation.Runner '--operation' 'VALIDATE_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PROFILE' 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne 'R6_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_PREFLIGHT_READY') {
    throw 'R6_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_OAUTH_NOT_READY'
  }
}

function ConvertTo-RestrictedNativeArgument([string]$Value) {
  if ($null -eq $Value -or $Value -match '["\r\n]') { throw 'R6_CURRENT_CANONICAL_V3_INPUT_TRANSPORT_ARGUMENT_UNSAFE' }
  return '"' + $Value + '"'
}

function Invoke-CurrentCanonicalProductionV3RunnerWithHiddenAccountInput([string]$Entrypoint, [string[]]$Arguments) {
  Assert-TranscriptSafe
  Set-OperatorLauncherStage 'READ_CLOUDFLARE_ACCOUNT'
  $secure = Read-Host 'Cloudflare account ID (hidden)' -AsSecureString
  $plaintext = $null
  $process = $null
  try {
    $plaintext = Convert-SecureStringToPlaintext $secure
    if ($plaintext -notmatch '^[a-f0-9]{32}$') { throw 'R6_CURRENT_CANONICAL_V3_ACCOUNT_INPUT_INVALID' }
    $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $node
    $startInfo.Arguments = ((@($Entrypoint) + @($Arguments) | ForEach-Object { ConvertTo-RestrictedNativeArgument ([string]$_) }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $false
    $startInfo.RedirectStandardError = $false
    $startInfo.CreateNoWindow = $false
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'R6_CURRENT_CANONICAL_V3_INPUT_TRANSPORT_START_FAILED' }
    $process.StandardInput.Write($plaintext)
    $process.StandardInput.Write("`n")
    $process.StandardInput.Close()
    $process.WaitForExit()
    return $process.ExitCode
  } catch {
    if ($_.Exception.Message -match '^R6_CURRENT_CANONICAL_V3_') { throw $_.Exception.Message }
    throw 'R6_CURRENT_CANONICAL_V3_INPUT_TRANSPORT_FAILED'
  } finally {
    if ($null -ne $process) { $process.Dispose() }
    $plaintext = $null
    if ($null -ne $secure) { $secure.Dispose() }
  }
}

function Assert-CurrentCanonicalProductionV3CaptureProvenance([pscustomobject]$Downstream, [pscustomobject]$Validation, [System.Collections.IDictionary]$State) {
  $State['failureStage'] = 'capture_terminal_locate'
  if (-not (Test-Path -LiteralPath $Downstream.CaptureTerminal -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_NOT_FOUND' }
  $State['captureTerminalLocated'] = $true

  $State['failureStage'] = 'capture_terminal_validate'
  $validationResult = Invoke-CurrentCanonicalProductionV3TerminalValidator $Validation $Downstream.CaptureTerminal $Downstream.Parent
  if ($validationResult -ne 'R6_CURRENT_CANONICAL_V3_TERMINAL_SUCCESS') { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_SCHEMA_INVALID' }
  $State['captureTerminalShaValidated'] = $true
  $State['captureTerminalSchemaAccepted'] = $true

  try { $capture = Read-AttestationJson $Downstream.CaptureTerminal } catch { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_SCHEMA_INVALID' }
  $State['failureStage'] = 'capture_terminal_classification'
  if ($capture.outerClassification -ne 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY' -or $null -ne $capture.innerClassification -or [int]$capture.childExitCode -ne 0) { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_CLASSIFICATION_INVALID' }
  $State['captureTerminalClassificationAccepted'] = $true

  $State['failureStage'] = 'capture_terminal_freshness'
  if (-not [bool]$capture.freshnessCheckPassed -or [int64]$capture.minimumValidityMilliseconds -ne 780000 -or [int64]$capture.remainingValidityMilliseconds -lt [int64]$capture.minimumValidityMilliseconds) { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_FRESHNESS_INVALID' }
  [void](Convert-StrictUtcTimestamp ([string]$capture.attestationIssuedAt) 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_FRESHNESS_INVALID')
  [void](Convert-StrictUtcTimestamp ([string]$capture.attestationExpiresAt) 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_FRESHNESS_INVALID')
  [void](Convert-StrictUtcTimestamp ([string]$capture.freshnessValidatedAt) 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_FRESHNESS_INVALID')
  $State['captureTerminalFreshnessAccepted'] = $true

  $State['failureStage'] = 'capture_parent_root'
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Downstream.CaptureTerminal)) -ne $Downstream.Parent) { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_PARENT_ROOT_MISMATCH' }
  $State['captureParentRootMatched'] = $true

  $State['failureStage'] = 'capture_command'
  $commands = @($capture.commands | ForEach-Object { [string]$_ })
  if ($commands.Count -ne 2 -or $commands[0] -notmatch [regex]::Escape('-AuthCheckOnly') -or $commands[0] -notmatch [regex]::Escape($Downstream.Root)) { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_CAPTURE_TERMINAL_SCHEMA_INVALID' }
  $State['captureCommandProvenanceMatched'] = $true

  $State['failureStage'] = 'attestation_binding'
  if ($capture.attestationPath -ne $DeploymentAttestationPath) { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ATTESTATION_PATH_MISMATCH' }
  $State['attestationPathMatched'] = $true
  if ($capture.attestationSha256 -ne $DeploymentAttestationSha256) { throw 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ATTESTATION_SHA_MISMATCH' }
  $State['attestationShaMatched'] = $true
  $State['captureProvenancePassed'] = $true
  $State['failureStage'] = 'attestation_read'
  return $capture
}

function Write-CurrentCanonicalProductionV3AuthCheckTerminal([string]$Path, [hashtable]$State) {
  $State.completedAt = [DateTime]::UtcNow.ToString('o')
  $State.schemaVersion = 'r6-auth-check-only-terminal-result-v3'
  $State.mode = 'AuthCheckOnly'
  $raw = [Text.Encoding]::UTF8.GetBytes(($State | ConvertTo-Json -Depth 5 -Compress) + [Environment]::NewLine)
  $temporary = "$Path.$PID.$([guid]::NewGuid().ToString()).tmp"
  try {
    [IO.File]::WriteAllBytes($temporary, $raw)
    Move-Item -LiteralPath $temporary -Destination $Path -ErrorAction Stop
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    [Array]::Clear($raw, 0, $raw.Length)
  }
}

function Invoke-CurrentCanonicalProductionV3AuthCheckOnly {
  $downstream = Get-CurrentCanonicalProductionV3DownstreamParent 'AuthCheckOnly' $EvidenceRoot
  New-Item -ItemType Directory -Path $downstream.Root -ErrorAction Stop | Out-Null
  $terminalPath = Join-Path $downstream.Root 'auth-check-only-terminal-result.json'
  $state = [ordered]@{
    schemaVersion = $null; mode = $null; startedAt = [DateTime]::UtcNow.ToString('o'); completedAt = $null
    executionWorktree = $ExecutionWorktree; executionCommit = $null; worktreeContract = 'current-canonical-production-v3'; worktreeValidationPassed = $false
    evidenceRoot = $downstream.Root; evidenceRootFresh = $true
    deploymentAttestationPath = $DeploymentAttestationPath; deploymentAttestationSha256 = $DeploymentAttestationSha256
    captureTerminalLocated = $false; captureTerminalShaValidated = $false; captureTerminalSchemaAccepted = $false; captureTerminalClassificationAccepted = $false; captureTerminalFreshnessAccepted = $false; captureParentRootMatched = $false; captureCommandProvenanceMatched = $false; attestationPathMatched = $false; attestationShaMatched = $false; captureProvenancePassed = $false
    attestationType = $null; attestationIssuedAt = $null; attestationExpiresAt = $null; attestationValidatedAt = $null; remainingValidityMs = $null; minimumRequiredValidityMs = $script:MinimumAttestationValidityMilliseconds; attestationFreshnessPassed = $false
    credentialPromptReached = $false; otpPromptReached = $false; authenticationStageReached = $false; endpointBindingPassed = $false; projectConfigurationPassed = $false; requestAttempted = $false; requestDispatched = $false; responseReceived = $false; networkFailureKind = 'none'; tlsFailureKind = 'none'; httpStatusCode = $null; providerReasonClass = 'not_observed'; providerReasonRecognized = $false; authenticationAttempted = $false; authenticationCompleted = $false; sessionCreated = $false; sessionValidated = $false; authenticatedCheckReached = $false; authenticatedCheckCompleted = $false
    pagesRequestCount = 0; deploymentRequestCount = 0; supabaseReadCount = 0; supabaseWriteCount = 0; productionMutationCount = 0
    childStarted = $false; childExitCode = 1; outerClassification = $null; innerClassification = $null; failureStage = 'worktree_validation'; exceptionType = $null; success = $false
  }
  try {
    Assert-CurrentCanonicalProductionV3Bindings
    $validation = Assert-CurrentCanonicalProductionV3ExecutionWorktree $ExecutionWorktree
    $state.executionWorktree = $validation.Path; $state.executionCommit = $validation.Head; $state.worktreeValidationPassed = $true
    $capture = Assert-CurrentCanonicalProductionV3CaptureProvenance $downstream $validation $state
    $attestation = Assert-DeploymentAttestation $DeploymentAttestationPath $DeploymentAttestationSha256
    $state.attestationType = 'CLOUDFLARE_PAGES_PROJECT_GET_V3'; $state.attestationIssuedAt = (Read-AttestationJson $attestation.Path).observedAt; $state.attestationExpiresAt = $attestation.ExpiresAt.ToUniversalTime().ToString('o'); $state.attestationValidatedAt = [DateTime]::UtcNow.ToString('o')
    $state.remainingValidityMs = Assert-MinimumAttestationValidity $attestation; $state.attestationFreshnessPassed = $true
    if ($env:R6_V3_DOWNSTREAM_WRAPPER_TEST_MODE -eq '1') {
      Invoke-AuthPasswordGrantFixture $state ([string]$env:R6_V3_AUTH_FAILURE_FIXTURE_KIND)
    } else {
      $state.credentialPromptReached = $true; $state.authenticationStageReached = $true; $inputs = Get-FutureInputs; $auth = Invoke-PasswordGrant $inputs $state; $state.authenticationCompleted = $true; $state.sessionCreated = $true; $state.sessionValidated = $true; $state.authenticatedCheckReached = $true; $state.authenticatedCheckCompleted = $true; $state.childStarted = $true; $state.childExitCode = 0; $auth = $null
    }
    $state.failureStage = 'complete'; $state.exceptionType = $null; $state.outerClassification = 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK'; $state.success = $true
  } catch {
    $state.outerClassification = 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED'; $state.innerClassification = Get-ValueBlindFailureCode $_ 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE'; $state.exceptionType = $_.Exception.GetType().FullName
  } finally {
    Write-CurrentCanonicalProductionV3AuthCheckTerminal $terminalPath $state
  }
  if (-not $state.success) { throw $state.outerClassification }
  Write-Output $state.outerClassification
}

function Invoke-CurrentCanonicalProductionV3TerminalValidator([pscustomobject]$Validation, [string]$TerminalResultPath, [string]$Root) {
  $attestationRoot = $script:ExpectedAttestationRoot
  if ($env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -eq '1') {
    $attestationRoot = [string]$env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT
    if (-not (Test-WindowsFullyQualifiedPath $attestationRoot) -or $attestationRoot -notlike "$([IO.Path]::GetTempPath().TrimEnd('\'))*") { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_INVALID' }
  }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = @(& node $Validation.Validator '--terminal-result-path' $TerminalResultPath '--tooling-commit' $script:V3FinalCommitBinding '--evidence-root' $Root '--attestation-root' $attestationRoot 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -notmatch '^R6_CURRENT_CANONICAL_V3_TERMINAL_(SUCCESS|FAILURE)$') { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  return $lines[0].ToString().Trim()
}

function Assert-CurrentCanonicalProductionV3TerminalFreshness([pscustomobject]$Terminal, [int64]$MinimumCurrentValidityMilliseconds = -1) {
  foreach ($name in @('attestationIssuedAt','attestationExpiresAt','freshnessValidatedAt','remainingValidityMilliseconds','minimumValidityMilliseconds','freshnessCheckPassed')) {
    if ($null -eq $Terminal.PSObject.Properties[$name]) { throw 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID' }
  }
  try {
    $issued = Convert-StrictUtcTimestamp ([string]$Terminal.attestationIssuedAt) 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID'
    $expires = Convert-StrictUtcTimestamp ([string]$Terminal.attestationExpiresAt) 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID'
    $validated = Convert-StrictUtcTimestamp ([string]$Terminal.freshnessValidatedAt) 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID'
  } catch { throw 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID' }
  if ($issued.Offset -ne [TimeSpan]::Zero -or $expires.Offset -ne [TimeSpan]::Zero -or $validated.Offset -ne [TimeSpan]::Zero -or $expires -le $issued -or ($expires - $issued).TotalMilliseconds -ne 900000 -or [int64]$Terminal.minimumValidityMilliseconds -ne 780000 -or -not [bool]$Terminal.freshnessCheckPassed) { throw 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID' }
  $recordedRemaining = [int64][math]::Round(($expires - $validated).TotalMilliseconds)
  if ([int64]$Terminal.remainingValidityMilliseconds -ne $recordedRemaining -or $recordedRemaining -lt [int64]$Terminal.minimumValidityMilliseconds) { throw 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID' }
  $minimumNow = if ($MinimumCurrentValidityMilliseconds -ge 0) { $MinimumCurrentValidityMilliseconds } else { [int64]$Terminal.minimumValidityMilliseconds }
  $remainingNow = ($expires - (Get-CurrentCanonicalProductionV3UtcNow)).TotalMilliseconds
  if ($remainingNow -lt $minimumNow) { throw 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID' }
  return [math]::Floor($remainingNow)
}

function Invoke-PrepareCurrentCanonicalProductionV3AuthDryRunAttestation([pscustomobject]$Validation, [switch]$SuppressDownstreamCommands, [string]$FixtureKind, [switch]$RootAlreadyCreated, [int64]$MinimumCurrentValidityMilliseconds = -1) {
  if (-not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE_REQUIRED' }
  Assert-TranscriptSafe
  if ($RootAlreadyCreated) {
    $base = [IO.Path]::GetFullPath($script:V3EvidenceRootBase)
    $root = [IO.Path]::GetFullPath($EvidenceRoot)
    if (-not (Test-WindowsFullyQualifiedPath $root) -or -not (Test-PathContainedWithin $base $root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { throw 'R6_CURRENT_CANONICAL_V3_EVIDENCE_ROOT_UNSAFE' }
  } else {
    $root = Assert-CurrentCanonicalProductionV3EvidenceRoot $EvidenceRoot
  }
  $transport = Get-Sha256 (Join-Path $Validation.Path 'scripts\qa\cloudflare-pages-project-v3-get.mjs')
  $entrypoint = $Validation.Runner
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $terminalResultPath = Join-Path $root 'current-canonical-production-v3-metadata-preparation-terminal-result.json'
  $exitCode = $null
  if (-not [string]::IsNullOrWhiteSpace($FixtureKind)) {
    if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -ne '1' -or $FixtureKind -notin @('authcheck-orchestration-success','target')) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TEST_FIXTURE_INVALID' }
    $fixtureGenerator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR
    if (-not (Test-WindowsFullyQualifiedPath $fixtureGenerator) -or -not (Test-Path -LiteralPath $fixtureGenerator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TEST_FIXTURE_INVALID' }
    $attestationRoot = [string]$env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT
    $authRoot = Join-Path $root 'auth-check'
    $wrapperSha256 = Get-Sha256 $script:WrapperPath
    $fixtureLines = @(& node $fixtureGenerator '--root' $root '--attestation-root' $attestationRoot '--tooling-commit' $script:V3FinalCommitBinding '--kind' $FixtureKind '--wrapper-path' $script:WrapperPath '--auth-root' $authRoot '--wrapper-sha256' $wrapperSha256 2>&1)
    if ($LASTEXITCODE -ne 0 -or $fixtureLines.Count -ne 1) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TEST_FIXTURE_INVALID' }
  } else {
    Invoke-CurrentCanonicalProductionV3OAuthPreflight $Validation
    $arguments = @('--operation','PREPARE_CURRENT_CANONICAL_PRODUCTION_V3_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Validation.Path,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$root,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$script:WrapperPath,'--execution-worktree',$Validation.Path,'--tooling-commit',$script:V3FinalCommitBinding,'--wrapper-sha256',(Get-Sha256 $script:WrapperPath),'--transport-sha256',$transport,'--parser-selector-sha256',$transport,'--command-output-mode','wrapper-buffered','--account-input-mode','wrapper-stdin')
    Push-Location -LiteralPath $Validation.Path
    try { $exitCode = Invoke-CurrentCanonicalProductionV3RunnerWithHiddenAccountInput $entrypoint $arguments } finally { Pop-Location }
  }
  if (-not (Test-Path -LiteralPath $terminalResultPath -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TERMINAL_MISSING' }
  $validatorResult = Invoke-CurrentCanonicalProductionV3TerminalValidator $Validation $terminalResultPath $root
  $terminal = Read-AttestationJson $terminalResultPath
  if (-not [string]::IsNullOrWhiteSpace($FixtureKind)) { $exitCode = [int]$terminal.childExitCode }
  if ($null -eq $exitCode -or $exitCode -ne [int]$terminal.childExitCode) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  if ($validatorResult -eq 'R6_CURRENT_CANONICAL_V3_TERMINAL_FAILURE') { throw ([string]$terminal.outerClassification) }
  if ($terminal.outerClassification -ne 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY') { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  Assert-CurrentCanonicalProductionV3TerminalFreshness $terminal $MinimumCurrentValidityMilliseconds | Out-Null
  $commands = @($terminal.commands | ForEach-Object { [string]$_ })
  if ($commands.Count -ne 2) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  if (-not $SuppressDownstreamCommands) {
    Write-Output 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY'
    foreach ($command in $commands) { Write-Output $command }
  }
}

function Write-CurrentCanonicalProductionV3OrchestrationTerminal([string]$Path, [System.Collections.IDictionary]$State) {
  $State['completedAt'] = Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow)
  $State['schemaVersion'] = 'r6-v3-capture-auth-check-orchestration-terminal-result-v1'
  $raw = [Text.Encoding]::UTF8.GetBytes(($State | ConvertTo-Json -Depth 6 -Compress) + [Environment]::NewLine)
  $temporary = "$Path.$PID.$([guid]::NewGuid().ToString()).tmp"
  try {
    [IO.File]::WriteAllBytes($temporary, $raw)
    Move-Item -LiteralPath $temporary -Destination $Path -ErrorAction Stop
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    [Array]::Clear($raw, 0, $raw.Length)
  }
}

function Invoke-CurrentCanonicalProductionV3OrchestrationTerminalValidator([string]$Path) {
  $validator = Join-Path $ExecutionWorktree 'scripts\qa\validate-r6-v3-capture-auth-check-orchestration-terminal.mjs'
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') { $validator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_ORCHESTRATION_VALIDATOR }
  if (-not (Test-WindowsFullyQualifiedPath $validator) -or -not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TERMINAL_VALIDATOR_MISSING' }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = @(& node $validator $Path 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne 'R6_V3_CAPTURE_AUTH_CHECK_ORCHESTRATION_TERMINAL_OK') {
    throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TERMINAL_INVALID'
  }
}

function Invoke-CurrentCanonicalProductionV3AuthCheckTerminalValidator([string]$Path) {
  $validator = Join-Path $ExecutionWorktree 'scripts\qa\validate-r6-v3-auth-check-terminal.mjs'
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') { $validator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_AUTH_VALIDATOR }
  if (-not (Test-WindowsFullyQualifiedPath $validator) -or -not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_AUTH_CHECK_TERMINAL_VALIDATOR_MISSING' }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = @(& node $validator $Path 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne 'R6_V3_AUTH_CHECK_TERMINAL_OK') {
    throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_AUTH_CHECK_TERMINAL_INVALID'
  }
}

function Sync-CurrentCanonicalProductionV3OrchestrationCaptureState([System.Collections.IDictionary]$State, [string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $State['captureTerminalPath'] = $Path
  $State['captureTerminalSha256'] = Get-Sha256 $Path
  try { $terminal = Read-AttestationJson $Path } catch { return }
  $State['captureOuterClassification'] = $terminal.outerClassification
  $State['captureInnerClassification'] = $terminal.innerClassification
  $State['captureChildExitCode'] = [int]$terminal.childExitCode
  $State['capturePagesRequestCount'] = if ([bool]$terminal.requestSentinelReached) { 1 } else { 0 }
  $State['pagesProjectGetCount'] = $State['capturePagesRequestCount']
  $State['captureCompleted'] = $true
}

function Sync-CurrentCanonicalProductionV3OrchestrationAuthState([System.Collections.IDictionary]$State, [string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $State['authCheckTerminalPath'] = $Path
  $State['authCheckTerminalSha256'] = Get-Sha256 $Path
  try { $terminal = Read-AttestationJson $Path } catch { return }
  $State['authCheckOuterClassification'] = $terminal.outerClassification
  $State['authCheckInnerClassification'] = $terminal.innerClassification
  $State['authCheckChildExitCode'] = [int]$terminal.childExitCode
  $State['authCheckCompleted'] = $true
  $State['authCheckSuccess'] = [bool]$terminal.success
  if ($State.Contains('authenticationCompleted')) {
    $State['authenticationCompleted'] = [bool]$terminal.authenticationCompleted
    $State['sessionValidated'] = [bool]$terminal.sessionValidated
    $State['authenticatedCheckCompleted'] = [bool]$terminal.authenticatedCheckCompleted
  }
  $State['supabaseReadCount'] = [int]$terminal.supabaseReadCount
  $State['supabaseWriteCount'] = [int]$terminal.supabaseWriteCount
  $State['productionMutationCount'] = [int]$terminal.productionMutationCount
}

function Invoke-PrepareCurrentCanonicalProductionV3AndAuthCheckOnly([pscustomobject]$Validation) {
  if (-not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TEST_FIXTURE_INVALID' }
  $root = Assert-CurrentCanonicalProductionV3EvidenceRoot $EvidenceRoot
  New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
  $captureTerminalPath = Join-Path $root 'current-canonical-production-v3-metadata-preparation-terminal-result.json'
  $authRoot = Join-Path $root 'auth-check'
  $authTerminalPath = Join-Path $authRoot 'auth-check-only-terminal-result.json'
  $terminalPath = Join-Path $root 'capture-auth-check-orchestration-terminal-result.json'
  $state = [ordered]@{
    schemaVersion = $null; startedAt = Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow); completedAt = $null; executionCommit = $null; worktreeContract = 'current-canonical-production-v3'
    outerClassification = $null; innerClassification = $null; success = $false; failureStage = 'worktree_validation'
    captureStarted = $false; captureCompleted = $false; captureSuccess = $false; captureTerminalPath = $null; captureTerminalSha256 = $null; captureOuterClassification = $null; captureInnerClassification = $null; captureChildExitCode = $null; capturePagesRequestCount = 0
    attestationPath = $null; attestationSha256 = $null; attestationType = $null; attestationIssuedAt = $null; attestationExpiresAt = $null; attestationFreshnessPassed = $false; remainingValidityMs = $null; minimumRequiredValidityMs = $script:MinimumAttestationValidityMilliseconds
    authCheckAuthorizedByMode = $true; authCheckStarted = $false; authCheckCompleted = $false; authCheckSuccess = $false; authCheckTerminalPath = $null; authCheckTerminalSha256 = $null; authCheckOuterClassification = $null; authCheckInnerClassification = $null; authCheckChildExitCode = $null
    dryRunStarted = $false; dryRunExecutionCount = 0; pagesProjectGetCount = 0; deploymentGetCount = 0; supabaseReadCount = 0; supabaseWriteCount = 0; productionMutationCount = 0; retryCount = 0
  }
  try {
    Assert-CurrentCanonicalProductionV3Bindings
    $state['executionCommit'] = $Validation.Head
    $state['failureStage'] = 'capture_execution'
    $state['captureStarted'] = $true
    $fixtureKind = if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') { $V3OrchestrationFixtureKind } else { $null }
    $null = Invoke-PrepareCurrentCanonicalProductionV3AuthDryRunAttestation $Validation -SuppressDownstreamCommands -FixtureKind $fixtureKind -RootAlreadyCreated -MinimumCurrentValidityMilliseconds $script:MinimumAttestationValidityMilliseconds
    Sync-CurrentCanonicalProductionV3OrchestrationCaptureState $state $captureTerminalPath
    $state['failureStage'] = 'capture_terminal_validation'
    if ($state['captureTerminalPath'] -ne $captureTerminalPath -or $state['captureOuterClassification'] -ne 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY' -or $null -ne $state['captureInnerClassification'] -or $state['captureChildExitCode'] -ne 0) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_CAPTURE_TERMINAL_INVALID' }
    $capture = Read-AttestationJson $captureTerminalPath
    if (@($capture.commands).Count -ne 2) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_CAPTURE_TERMINAL_INVALID' }
    $state['captureSuccess'] = $true
    $state['failureStage'] = 'capture_provenance'
    $remaining = Assert-CurrentCanonicalProductionV3TerminalFreshness $capture $script:MinimumAttestationValidityMilliseconds
    $state['attestationPath'] = [string]$capture.attestationPath
    $state['attestationSha256'] = [string]$capture.attestationSha256
    $state['failureStage'] = 'attestation_validation'
    $attestation = Assert-DeploymentAttestation $state['attestationPath'] $state['attestationSha256']
    $state['attestationType'] = 'CLOUDFLARE_PAGES_PROJECT_GET_V3'
    $state['attestationIssuedAt'] = (Read-AttestationJson $attestation.Path).observedAt
    $state['attestationExpiresAt'] = Format-StrictUtcTimestamp $attestation.ExpiresAt
    $state['remainingValidityMs'] = Assert-MinimumAttestationValidity $attestation
    if ($state['remainingValidityMs'] -lt $script:MinimumAttestationValidityMilliseconds -or $remaining -lt $script:MinimumAttestationValidityMilliseconds) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_AUTH_CHECK_FRESHNESS_INSUFFICIENT' }
    $state['attestationFreshnessPassed'] = $true
    $state['failureStage'] = 'auth_check_invocation'
    if (Test-Path -LiteralPath $authRoot) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_AUTH_CHECK_ROOT_UNSAFE' }
    $DeploymentAttestationPath = $state['attestationPath']
    $DeploymentAttestationSha256 = $state['attestationSha256']
    $EvidenceRoot = $authRoot
    $state['authCheckStarted'] = $true
    $null = Invoke-CurrentCanonicalProductionV3AuthCheckOnly
    Sync-CurrentCanonicalProductionV3OrchestrationAuthState $state $authTerminalPath
    $state['failureStage'] = 'auth_check_terminal_validation'
    Invoke-CurrentCanonicalProductionV3AuthCheckTerminalValidator $authTerminalPath
    if (-not $state['authCheckSuccess'] -or $state['authCheckOuterClassification'] -ne 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK' -or $state['authCheckChildExitCode'] -ne 0) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_AUTH_CHECK_FAILED' }
    $state['failureStage'] = 'complete'
    $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_CAPTURE_AND_AUTH_CHECK_ONLY_READY'
    $state['success'] = $true
  } catch {
    Sync-CurrentCanonicalProductionV3OrchestrationCaptureState $state $captureTerminalPath
    Sync-CurrentCanonicalProductionV3OrchestrationAuthState $state $authTerminalPath
    $code = Get-ValueBlindFailureCode $_ 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_UNEXPECTED_FAILURE'
    $state['innerClassification'] = $code
    if ($state['authCheckStarted']) { $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_AUTH_CHECK_FAILED' }
    elseif ($state['failureStage'] -eq 'attestation_validation') { $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_ATTESTATION_SCHEMA_INVALID' }
    elseif ($state['failureStage'] -eq 'capture_provenance') { $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_CAPTURE_PROVENANCE_INVALID' }
    elseif ($state['failureStage'] -match '^capture_') { $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_CAPTURE_FAILED' }
    else { $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_UNEXPECTED_FAILURE' }
  } finally {
    Write-CurrentCanonicalProductionV3OrchestrationTerminal $terminalPath $state
  }
  Invoke-CurrentCanonicalProductionV3OrchestrationTerminalValidator $terminalPath
  if (-not $state['success']) { throw $state['outerClassification'] }
  Write-Output $state['outerClassification']
}

function Write-CurrentCanonicalProductionV3DryRunTerminal([string]$Path, [System.Collections.IDictionary]$State) {
  $State['completedAt'] = Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow)
  $State['schemaVersion'] = 'r6-v4-dry-run-terminal-result-v4'
  $raw = [Text.Encoding]::UTF8.GetBytes(($State | ConvertTo-Json -Depth 6 -Compress) + [Environment]::NewLine)
  $temporary = "$Path.$PID.$([guid]::NewGuid().ToString()).tmp"
  try { [IO.File]::WriteAllBytes($temporary, $raw); Move-Item -LiteralPath $temporary -Destination $Path -ErrorAction Stop }
  finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue; [Array]::Clear($raw, 0, $raw.Length) }
}

function Invoke-CurrentCanonicalProductionV3DryRunTerminalValidator([string]$Path) {
  $validator = Join-Path $ExecutionWorktree 'scripts\qa\validate-r6-v3-dry-run-terminal.mjs'
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') { $validator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_DRY_RUN_VALIDATOR }
  if (-not (Test-WindowsFullyQualifiedPath $validator) -or -not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_TERMINAL_VALIDATOR_MISSING' }
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $lines = @(& node $validator $Path 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne 'R6_V3_DRY_RUN_TERMINAL_OK') { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_TERMINAL_INVALID' }
}

function Write-CurrentCanonicalProductionV3DryRunOrchestrationTerminal([string]$Path, [System.Collections.IDictionary]$State) {
  $State['completedAt'] = Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow)
  $State['schemaVersion'] = 'r6-v4-capture-authcheck-dryrun-orchestration-terminal-result-v4'
  $raw = [Text.Encoding]::UTF8.GetBytes(($State | ConvertTo-Json -Depth 7 -Compress) + [Environment]::NewLine)
  $temporary = "$Path.$PID.$([guid]::NewGuid().ToString()).tmp"
  try { [IO.File]::WriteAllBytes($temporary, $raw); Move-Item -LiteralPath $temporary -Destination $Path -ErrorAction Stop }
  finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue; [Array]::Clear($raw, 0, $raw.Length) }
}

function Invoke-CurrentCanonicalProductionV3DryRunOrchestrationTerminalValidator([string]$Path) {
  $validator = Join-Path $ExecutionWorktree 'scripts\qa\validate-r6-v3-capture-authcheck-dryrun-orchestration-terminal.mjs'
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') { $validator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_THREE_STAGE_VALIDATOR }
  if (-not (Test-WindowsFullyQualifiedPath $validator) -or -not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_TERMINAL_VALIDATOR_MISSING' }
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $lines = @(& node $validator $Path 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne 'R6_V3_CAPTURE_AUTHCHECK_DRYRUN_ORCHESTRATION_TERMINAL_OK') { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_TERMINAL_INVALID' }
}

function New-SyntheticDryRunTargetBinding([string]$Root, [string]$ToolingCommit, [ValidateSet('target-binding', 'target-binding-alternate')][string]$Kind = 'target-binding') {
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -ne '1') { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_BINDING_UNSAFE' }
  $generator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR
  if (-not (Test-WindowsFullyQualifiedPath $generator) -or -not (Test-Path -LiteralPath $generator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_BINDING_FIXTURE_INVALID' }
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $lines = @(& node $generator '--root' $Root '--tooling-commit' $ToolingCommit '--kind' $Kind 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0 -or $lines.Count -ne 1) { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_BINDING_FIXTURE_INVALID' }
  try { $metadata = $lines[0].ToString() | ConvertFrom-Json -ErrorAction Stop } catch { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_BINDING_FIXTURE_INVALID' }
  $path = [string]$metadata.targetBindingPath
  if (-not (Test-WindowsFullyQualifiedPath $path) -or $path -ne (Join-Path $Root 'canonical-canary-target-binding.json') -or -not (Test-Path -LiteralPath $path -PathType Leaf) -or [string]$metadata.targetBindingSha256 -ne (Get-Sha256 $path)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_BINDING_FIXTURE_INVALID' }
  return [pscustomobject]@{ Path = $path; Sha256 = [string]$metadata.targetBindingSha256; Binding = Read-AttestationJson $path }
}

function New-SyntheticDryRunChildEntrypoint([string]$Root, [string]$ToolingCommit) {
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -ne '1') { throw 'R6_CURRENT_CANONICAL_V3_TEST_CHILD_UNSAFE' }
  $generator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR
  if (-not (Test-WindowsFullyQualifiedPath $generator) -or -not (Test-Path -LiteralPath $generator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_CHILD_FIXTURE_INVALID' }
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $lines = @(& node $generator '--root' $Root '--tooling-commit' $ToolingCommit '--kind' 'dry-run-child' 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0 -or $lines.Count -ne 1) { throw 'R6_CURRENT_CANONICAL_V3_TEST_CHILD_FIXTURE_INVALID' }
  try { $metadata = $lines[0].ToString() | ConvertFrom-Json -ErrorAction Stop } catch { throw 'R6_CURRENT_CANONICAL_V3_TEST_CHILD_FIXTURE_INVALID' }
  $entrypoint = [string]$metadata.childEntrypoint
  if (-not (Test-WindowsFullyQualifiedPath $entrypoint) -or $entrypoint -ne (Join-Path $Root 'synthetic-dry-run-child.mjs') -or -not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_CHILD_FIXTURE_INVALID' }
  return $entrypoint
}

function New-SyntheticTargetResolverEntrypoint([string]$Root, [string]$ToolingCommit) {
  if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -ne '1') { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_RESOLVER_UNSAFE' }
  $generator = [string]$env:R6_V3_ORCHESTRATION_WRAPPER_TEST_FIXTURE_GENERATOR
  if (-not (Test-WindowsFullyQualifiedPath $generator) -or -not (Test-Path -LiteralPath $generator -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_RESOLVER_FIXTURE_INVALID' }
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $lines = @(& node $generator '--root' $Root '--tooling-commit' $ToolingCommit '--kind' 'target-resolver' 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0 -or $lines.Count -ne 1) { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_RESOLVER_FIXTURE_INVALID' }
  try { $metadata = $lines[0].ToString() | ConvertFrom-Json -ErrorAction Stop } catch { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_RESOLVER_FIXTURE_INVALID' }
  $entrypoint = [string]$metadata.resolverEntrypoint
  if (-not (Test-WindowsFullyQualifiedPath $entrypoint) -or $entrypoint -ne (Join-Path $Root 'synthetic-target-resolver.mjs') -or -not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_RESOLVER_FIXTURE_INVALID' }
  return $entrypoint
}

function Set-TargetResolutionInitialState([System.Collections.IDictionary]$State) {
  $State['authenticationCompleted'] = $false
  $State['targetResolutionStarted'] = $false
  $State['targetResolutionCompleted'] = $false
  $State['targetResolutionSucceeded'] = $false
  $State['targetResolutionFailureCategory'] = $null
  $State['targetResultCountClass'] = 'UNKNOWN'
  $State['targetEligibleState'] = 'UNKNOWN'
  $State['canonicalTargetResolved'] = $false
  $State['canonicalCircleIdResolved'] = $false
  $State['canonicalCircleSlugResolved'] = $false
  $State['targetBindingArtifactPresent'] = $false
  $State['targetBindingValidationPassed'] = $false
  $State['targetBindingCreated'] = $false
  $State['targetBindingHashCreated'] = $false
  $State['targetBoundExecutionPlanHashCreated'] = $false
}

function Get-TargetResolutionFailureCategory([string]$Code) {
  switch ($Code) {
    { $_ -in @('QA_CANARY_TARGET_REQUESTED_SLUG_INVALID', 'QA_CANARY_TARGET_BINDING_ARGUMENTS_INVALID') } { return [pscustomobject]@{ Category='TARGET_INPUT_INVALID'; ResultCount='UNKNOWN'; Eligible='UNKNOWN' } }
    'QA_CANARY_TARGET_NOT_FOUND' { return [pscustomobject]@{ Category='TARGET_NOT_FOUND'; ResultCount='ZERO'; Eligible='UNKNOWN' } }
    'QA_CANARY_TARGET_AMBIGUOUS' { return [pscustomobject]@{ Category='TARGET_NON_UNIQUE'; ResultCount='MULTIPLE'; Eligible='UNKNOWN' } }
    'QA_CANARY_TARGET_INELIGIBLE' { return [pscustomobject]@{ Category='TARGET_INELIGIBLE'; ResultCount='ONE'; Eligible='INELIGIBLE' } }
    { $_ -in @('QA_CANARY_TARGET_CIRCLE_ID_MISSING', 'QA_CANARY_TARGET_CIRCLE_SLUG_MISSING', 'QA_CANARY_CIRCLE_RESOLUTION_INCOMPLETE') } { return [pscustomobject]@{ Category='TARGET_RESOLUTION_INCOMPLETE'; ResultCount='ONE'; Eligible='UNKNOWN' } }
    { $_ -in @('QA_CANARY_AUTHENTICATION_FAILED', 'QA_CANARY_CIRCLE_LOOKUP_FAILED', 'QA_CANARY_NETWORK_AMBIGUOUS') } { return [pscustomobject]@{ Category='PROVIDER_OR_READ_FAILURE'; ResultCount='UNKNOWN'; Eligible='UNKNOWN' } }
    'QA_CANARY_TARGET_BINDING_OUTPUT_EXISTS' { return [pscustomobject]@{ Category='BINDING_ARTIFACT_PRESENT'; ResultCount='UNKNOWN'; Eligible='UNKNOWN' } }
    { $_ -in @('QA_CANARY_TARGET_BINDING_INVALID', 'QA_CANARY_TARGET_BINDING_HASH_MISMATCH') } { return [pscustomobject]@{ Category='BINDING_ARTIFACT_INVALID'; ResultCount='ONE'; Eligible='UNKNOWN' } }
    'QA_CANARY_TARGET_BINDING_MISSING' { return [pscustomobject]@{ Category='BINDING_ARTIFACT_MISSING'; ResultCount='UNKNOWN'; Eligible='UNKNOWN' } }
    'QA_CANARY_TARGET_RESOLUTION_OUTPUT_INVALID' { return [pscustomobject]@{ Category='RESOLVER_OUTPUT_INVALID'; ResultCount='UNKNOWN'; Eligible='UNKNOWN' } }
    'QA_CANARY_TARGET_RESOLUTION_PROCESS_FAILED' { return [pscustomobject]@{ Category='RESOLVER_PROCESS_FAILURE'; ResultCount='UNKNOWN'; Eligible='UNKNOWN' } }
    default { return [pscustomobject]@{ Category='UNKNOWN_TARGET_RESOLUTION_FAILURE'; ResultCount='UNKNOWN'; Eligible='UNKNOWN' } }
  }
}

function Set-TargetResolutionFailureState([System.Collections.IDictionary]$State, [string]$Code, [string]$TargetPath) {
  $diagnostic = Get-TargetResolutionFailureCategory $Code
  $State['failureStage'] = 'TARGET_RESOLUTION'
  $State['targetResolutionStarted'] = $true
  $State['targetResolutionCompleted'] = $true
  $State['targetResolutionSucceeded'] = $false
  $State['targetResolutionFailureCategory'] = $diagnostic.Category
  $State['targetResultCountClass'] = $diagnostic.ResultCount
  $State['targetEligibleState'] = $diagnostic.Eligible
  $State['canonicalTargetResolved'] = $false
  $State['canonicalCircleIdResolved'] = $false
  $State['canonicalCircleSlugResolved'] = $false
  $State['targetBindingArtifactPresent'] = Test-Path -LiteralPath $TargetPath -PathType Leaf
  $State['targetBindingValidationPassed'] = $false
  $State['targetBindingCreated'] = $false
  $State['targetBindingHashCreated'] = $false
  $State['targetBoundExecutionPlanHashCreated'] = $false
}

function Set-TargetResolutionSuccessState([System.Collections.IDictionary]$State) {
  $State['targetResolutionStarted'] = $true
  $State['targetResolutionCompleted'] = $true
  $State['targetResolutionSucceeded'] = $true
  $State['targetResolutionFailureCategory'] = $null
  $State['targetResultCountClass'] = 'ONE'
  $State['targetEligibleState'] = 'ELIGIBLE'
  $State['canonicalTargetResolved'] = $true
  $State['canonicalCircleIdResolved'] = $true
  $State['canonicalCircleSlugResolved'] = $true
  $State['targetBindingArtifactPresent'] = $true
  $State['targetBindingValidationPassed'] = $true
  $State['targetBindingCreated'] = $true
  $State['targetBindingHashCreated'] = $true
  $State['targetBoundExecutionPlanHashCreated'] = $true
}

function Get-TargetResolutionFailureCode([string[]]$Lines, [int]$ExitCode) {
  $known = @('QA_CANARY_TARGET_REQUESTED_SLUG_INVALID', 'QA_CANARY_TARGET_BINDING_ARGUMENTS_INVALID', 'QA_CANARY_TARGET_NOT_FOUND', 'QA_CANARY_TARGET_AMBIGUOUS', 'QA_CANARY_TARGET_INELIGIBLE', 'QA_CANARY_TARGET_CIRCLE_ID_MISSING', 'QA_CANARY_TARGET_CIRCLE_SLUG_MISSING', 'QA_CANARY_CIRCLE_RESOLUTION_INCOMPLETE', 'QA_CANARY_AUTHENTICATION_FAILED', 'QA_CANARY_CIRCLE_LOOKUP_FAILED', 'QA_CANARY_NETWORK_AMBIGUOUS', 'QA_CANARY_TARGET_BINDING_OUTPUT_EXISTS', 'QA_CANARY_TARGET_BINDING_INVALID', 'QA_CANARY_TARGET_BINDING_HASH_MISMATCH')
  $observed = @($Lines | ForEach-Object { [regex]::Matches([string]$_, 'QA_CANARY_[A-Z0-9_]+') } | ForEach-Object { $_.Value } | Select-Object -Unique)
  foreach ($code in $known) { if ($observed -contains $code) { return $code } }
  if ($ExitCode -ne 0) { return 'QA_CANARY_TARGET_RESOLUTION_PROCESS_FAILED' }
  return 'QA_CANARY_TARGET_RESOLUTION_OUTPUT_INVALID'
}

function Invoke-CanonicalCanaryTargetBindingValidator([string]$Path) {
  $validator = Join-Path $ExecutionWorktree 'scripts\qa\validate-canonical-canary-target-binding.mjs'
  if (-not (Test-WindowsFullyQualifiedPath $validator) -or -not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'QA_CANARY_TARGET_BINDING_INVALID' }
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $lines = @(& node $validator $Path 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne 'QA_CANARY_TARGET_BINDING_OK') { throw 'QA_CANARY_TARGET_BINDING_INVALID' }
}

function ConvertTo-TargetBindingComparisonJson([object]$Value) {
  return ($Value | ConvertTo-Json -Depth 32 -Compress)
}

function Sync-VerifiedTargetBindingFromDryRunTerminal([System.Collections.IDictionary]$State, [string]$DryRunTerminalPath) {
  Invoke-CurrentCanonicalProductionV3DryRunTerminalValidator $DryRunTerminalPath
  $dryRunTerminal = Read-AttestationJson $DryRunTerminalPath
  $targetResolved = [bool]$dryRunTerminal.canonicalTargetResolved -and [bool]$dryRunTerminal.targetBindingArtifactPresent -and [bool]$dryRunTerminal.targetBindingValidationPassed -and [bool]$dryRunTerminal.targetBindingCreated
  $hasAnyBindingField = $null -ne $dryRunTerminal.targetBinding -or $null -ne $dryRunTerminal.targetBindingPath -or $null -ne $dryRunTerminal.targetBindingSha256
  if (-not $targetResolved) {
    if ($hasAnyBindingField) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_TARGET_BINDING_SYNC_INVALID' }
    return $dryRunTerminal
  }

  if (-not [bool]$dryRunTerminal.targetResolutionSucceeded -or -not [bool]$dryRunTerminal.canonicalCircleIdResolved -or -not [bool]$dryRunTerminal.canonicalCircleSlugResolved -or -not [bool]$dryRunTerminal.targetBindingHashCreated -or -not [bool]$dryRunTerminal.targetBoundExecutionPlanHashCreated) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_TARGET_BINDING_SYNC_INVALID' }
  $bindingPath = [string]$dryRunTerminal.targetBindingPath
  $expectedPath = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetDirectoryName($DryRunTerminalPath)) 'canonical-canary-target-binding.json'))
  $normalizedPath = if (Test-WindowsFullyQualifiedPath $bindingPath) { [IO.Path]::GetFullPath($bindingPath) } else { '' }
  $bindingSha256 = [string]$dryRunTerminal.targetBindingSha256
  if ([string]::IsNullOrWhiteSpace($normalizedPath) -or -not $bindingPath.Equals($normalizedPath, [StringComparison]::OrdinalIgnoreCase) -or -not $normalizedPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $normalizedPath -PathType Leaf) -or $bindingSha256 -notmatch '^[a-f0-9]{64}$' -or (Get-Sha256 $normalizedPath) -ne $bindingSha256) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_TARGET_BINDING_SYNC_INVALID' }
  Invoke-CanonicalCanaryTargetBindingValidator $normalizedPath
  $bindingArtifact = Read-AttestationJson $normalizedPath
  if ((ConvertTo-TargetBindingComparisonJson $dryRunTerminal.targetBinding) -cne (ConvertTo-TargetBindingComparisonJson $bindingArtifact)) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_TARGET_BINDING_SYNC_INVALID' }
  $State['targetBinding'] = $dryRunTerminal.targetBinding
  $State['targetBindingPath'] = $dryRunTerminal.targetBindingPath
  $State['targetBindingSha256'] = $dryRunTerminal.targetBindingSha256
  return $dryRunTerminal
}

function Sync-CurrentCanonicalProductionV3DryRunLifecycleState([System.Collections.IDictionary]$State, [object]$DryRunTerminal) {
  $State['dryRunExecutionCommit'] = [string]$DryRunTerminal.executionCommit
  $State['dryRunReceiptRunnerCommit'] = $DryRunTerminal.receiptRunnerCommit
  $State['dryRunExpectedToolingCommit'] = $DryRunTerminal.expectedToolingCommit
  $State['dryRunPlannedMutationCount'] = [int]$DryRunTerminal.plannedMutationCount
  $State['dryRunActualMutationCount'] = [int]$DryRunTerminal.actualMutationCount
  $State['dryRunReservationAttempted'] = [bool]$DryRunTerminal.reservationAttempted
  $State['dryRunReservationCompleted'] = [bool]$DryRunTerminal.reservationCompleted
  $State['dryRunReceiptCreated'] = [bool]$DryRunTerminal.receiptCreated
  $State['dryRunReceiptState'] = [string]$DryRunTerminal.receiptState
  $State['dryRunExecutorStarted'] = [bool]$DryRunTerminal.childStarted
  $State['dryRunCanaryChildStarted'] = [bool]$DryRunTerminal.canaryChildStarted
  $State['dryRunExecutorCompleted'] = [bool]$DryRunTerminal.childCompleted
  $State['dryRunExecutorTimedOut'] = [bool]$DryRunTerminal.childTimedOut
  $State['dryRunJournalCreated'] = [bool]$DryRunTerminal.journalCreated
  $State['dryRunFinalAuthorizationCreated'] = [bool]$DryRunTerminal.finalAuthorizationCreated
  $State['dryRunUnexpectedMutationCount'] = [int]$DryRunTerminal.unexpectedMutationCount
  $State['dryRunSupabaseWriteCount'] = [int]$DryRunTerminal.supabaseWriteCount
  $State['supabaseWriteCount'] = [int]$DryRunTerminal.supabaseWriteCount
  $State['productionMutationCount'] = [int]$DryRunTerminal.productionMutationCount
}

function Invoke-CurrentCanonicalProductionV3DryRunOnly([pscustomobject]$Validation, [string]$Root, [string]$RequestedRunId, [string]$AttestationPath, [string]$AttestationSha256) {
  if (Test-Path -LiteralPath $Root) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ROOT_UNSAFE' }
  New-Item -ItemType Directory -Path $Root -ErrorAction Stop | Out-Null
  $terminalPath = Join-Path $Root 'dry-run-only-terminal-result.json'
  $now = Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow)
  $state = [ordered]@{ schemaVersion=$null; startedAt=$now; completedAt=$null; runId=$RequestedRunId; outerClassification=$null; innerClassification=$null; success=$false; failureStage='RUN_ID_FORMAT_VALIDATION'; captureProvenancePassed=$true; authProvenancePassed=$true; attestationFreshnessPassed=$false; minimumRequiredValidityMs=$script:MinimumAttestationValidityMilliseconds; remainingValidityMs=0; runIdValidationPassed=$false; reservationAttempted=$false; reservationCompleted=$false; receiptCreated=$false; receiptState='NOT_CREATED_OR_UNCONFIRMED'; executionCommit=$Validation.Head; receiptRunnerCommit=$null; expectedToolingCommit=$null; targetBinding=$null; targetBindingPath=$null; targetBindingSha256=$null; childStarted=$false; canaryChildStarted=$false; childCompleted=$false; childTimedOut=$false; stdoutClassification=$null; stderrClassification=$null; childTerminalPath=$null; childTerminalSha256=$null; childTerminalLocated=$false; childTerminalValidated=$false; adapterReached=$false; journalCreated=$false; childExitCode=1; plannedMutationCount=2; actualMutationCount=0; unexpectedMutationCount=0; supabaseWriteCount=0; productionMutationCount=0; retryCount=0; finalAuthorizationCreated=$false }
  Set-TargetResolutionInitialState $state
  $confirmationHash = $null; $auth = $null
  try {
    if ($RequestedRunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_RUN_ID_INVALID' }
    $state['failureStage'] = 'attestation_validation'
    $attestation = Assert-DeploymentAttestation $AttestationPath $AttestationSha256
    $state['remainingValidityMs'] = Assert-MinimumAttestationValidity $attestation
    $state['attestationFreshnessPassed'] = $true
    if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') {
      if (-not [string]::IsNullOrWhiteSpace([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_PRE_TOOLING_FAILURE)) {
        $state['failureStage'] = 'AUTHENTICATION'; $state['runIdValidationPassed'] = $true; $state['reservationAttempted'] = $true; $state['reservationCompleted'] = $true; $state['receiptCreated'] = $true; $state['receiptState'] = 'PENDING'; $state['receiptRunnerCommit'] = $Validation.Head
        throw ([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_PRE_TOOLING_FAILURE)
      }
      if (-not [string]::IsNullOrWhiteSpace([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_TARGET_RESOLUTION_FAILURE)) {
        $state['runIdValidationPassed'] = $true; $state['authenticationCompleted'] = $true
        $code = [string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_TARGET_RESOLUTION_FAILURE
        Set-TargetResolutionFailureState $state $code (Join-Path $Root 'canonical-canary-target-binding.json')
        throw $code
      }
      $auth = [pscustomobject]@{ AccessToken = 'synthetic-access'; AnonKey = 'synthetic-anon'; ProjectRef = 'synthetic-project'; AttestationPath = $AttestationPath; AttestationSha256 = $AttestationSha256 }
      if ($env:R6_V3_ORCHESTRATION_TEST_USE_REAL_TARGET_RESOLVER -eq '1') {
        $resolverEntrypoint = New-SyntheticTargetResolverEntrypoint $Root $Validation.Head
        [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_TEST_TARGET_RESOLVER_ENTRYPOINT', $resolverEntrypoint, 'Process')
        $state['authenticationCompleted'] = $true
        $targetBindingPath = Resolve-DryRunCanonicalTarget $auth 'synthetic-canonical-circle' $Root $Validation.Head $state
        $state['targetBindingPath'] = $targetBindingPath; $state['targetBindingSha256'] = Get-Sha256 $targetBindingPath; $state['targetBinding'] = Read-AttestationJson $targetBindingPath
      } else {
        $syntheticTargetBinding = New-SyntheticDryRunTargetBinding $Root $Validation.Head
        $state['authenticationCompleted'] = $true
        $state['targetBindingPath'] = $syntheticTargetBinding.Path; $state['targetBindingSha256'] = $syntheticTargetBinding.Sha256; $state['targetBinding'] = $syntheticTargetBinding.Binding
        Set-TargetResolutionSuccessState $state
      }
      $bindingMutation = [string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_TARGET_BINDING_MUTATION
      if ($bindingMutation -eq 'missing') {
        $state['targetBinding'] = $null; $state['targetBindingPath'] = $null; $state['targetBindingSha256'] = $null
      } elseif ($bindingMutation -eq 'sha') {
        $state['targetBindingSha256'] = ('0' * 64)
      } elseif ($bindingMutation -eq 'path') {
        $alternateTargetBinding = New-SyntheticDryRunTargetBinding (Join-Path $Root 'alternate-target-binding') $Validation.Head 'target-binding-alternate'
        $state['targetBindingPath'] = $alternateTargetBinding.Path; $state['targetBindingSha256'] = $alternateTargetBinding.Sha256; $state['targetBinding'] = $alternateTargetBinding.Binding
      } elseif ($bindingMutation -eq 'object') {
        $alternateTargetBinding = New-SyntheticDryRunTargetBinding (Join-Path $Root 'alternate-target-binding') $Validation.Head 'target-binding-alternate'
        $state['targetBinding'] = $alternateTargetBinding.Binding
      } elseif (-not [string]::IsNullOrWhiteSpace($bindingMutation)) {
        throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_BINDING_MUTATION_INVALID'
      }
      if (-not [string]::IsNullOrWhiteSpace([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_RESERVATION_FAILURE)) {
        $state['failureStage'] = 'RUN_ID_RESERVATION'; $state['runIdValidationPassed'] = $true; $state['reservationAttempted'] = $true
        throw ([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_RESERVATION_FAILURE)
      }
      $state['runIdValidationPassed'] = $true; $state['reservationAttempted'] = $true; $state['reservationCompleted'] = $true; $state['receiptCreated'] = $true; $state['receiptState'] = 'PENDING'; $state['receiptRunnerCommit'] = $Validation.Head; $state['expectedToolingCommit'] = $Validation.Head
      $reservation = [pscustomobject]@{ RegistryRoot = $Root; ReceiptPath = (Join-Path $Root 'synthetic-receipt.json'); ReceiptSha256 = ('a' * 64); InvocationNonce = '11111111-1111-4111-8111-111111111111'; RunnerCommit = $Validation.Head; WrapperSha256 = ('b' * 64); ChildCommandDigest = ('c' * 64) }
      $childTerminalPath = Join-Path $Root 'minimal-canary-child-terminal-result.json'
      $entrypoint = New-SyntheticDryRunChildEntrypoint $Root $Validation.Head
      [Environment]::SetEnvironmentVariable('R6_V3_ORCHESTRATION_TEST_DRY_RUN_CHILD_ENTRYPOINT', $entrypoint, 'Process')
      Set-RunnerEnvironment $auth 'DryRunOnly' $RequestedRunId $reservation $childTerminalPath $Validation.Head $state['targetBindingPath']
      $state['failureStage'] = 'MINIMAL_CANARY_CHILD_LAUNCH'; $state['childStarted'] = $true; $state['canaryChildStarted'] = $true
      $null = Invoke-ValidatedDryRunChild $Validation.Path $RequestedRunId $childTerminalPath $Validation.Head $state
      if (-not [string]::IsNullOrWhiteSpace([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_POST_RESERVATION_FAILURE)) {
        $state['failureStage'] = 'MINIMAL_CANARY_CHILD_LAUNCH'
        throw ([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_POST_RESERVATION_FAILURE)
      }
    } else {
      $state['failureStage'] = 'RUN_ID_REGISTRY_LOOKUP'; Assert-RunIdEligible $Validation.Path $RequestedRunId | Out-Null; Assert-RunIdJournalAbsent $RequestedRunId; $state['runIdValidationPassed'] = $true
      Assert-TranscriptSafe; $confirmation = Read-Host 'Fresh dry-run-only confirmation token (hidden)' -AsSecureString; $confirmationHash = Get-ConfirmationHash $confirmation
      $state['failureStage'] = 'AUTHENTICATION'; $inputs = Get-FutureInputs -IncludeDryRunTarget; $auth = Invoke-PasswordGrant $inputs; $state['authenticationCompleted'] = $true
      $auth | Add-Member -NotePropertyName AttestationPath -NotePropertyValue $attestation.Path
      $auth | Add-Member -NotePropertyName AttestationSha256 -NotePropertyValue $attestation.Sha256
      $validatedExecutionCommit = Get-ValidatedExecutionCommit $Validation
      if ($validatedExecutionCommit -ne [string]$Validation.Head) { throw 'QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH' }
      $targetBindingPath = Resolve-DryRunCanonicalTarget $auth $inputs.RequestedCircleSlug $Root $validatedExecutionCommit $state
      $state['targetBindingPath'] = $targetBindingPath; $state['targetBindingSha256'] = Get-Sha256 $targetBindingPath; $state['targetBinding'] = Read-AttestationJson $targetBindingPath
      $state['failureStage'] = 'RUN_ID_RESERVATION'; $state['reservationAttempted'] = $true; $reservation = Reserve-ConsumedRun $Validation $RequestedRunId 'dry-run' $confirmationHash '' '' $targetBindingPath; $state['reservationCompleted'] = $true; $state['receiptCreated'] = $true; $state['receiptState'] = 'PENDING'; $state['receiptRunnerCommit'] = [string]$reservation.RunnerCommit
      if ($validatedExecutionCommit -ne [string]$reservation.RunnerCommit -or $validatedExecutionCommit -ne [string]$Validation.Head) { throw 'QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH' }
      $state['expectedToolingCommit'] = $validatedExecutionCommit
      $childTerminalPath = Join-Path $Root 'minimal-canary-child-terminal-result.json'
      Set-RunnerEnvironment $auth 'DryRunOnly' $RequestedRunId $reservation $childTerminalPath $validatedExecutionCommit $targetBindingPath
      $state['failureStage'] = 'MINIMAL_CANARY_CHILD_LAUNCH'; $state['childStarted'] = $true; $state['canaryChildStarted'] = $true
      $null = Invoke-ValidatedDryRunChild $Validation.Path $RequestedRunId $childTerminalPath $validatedExecutionCommit $state
    }
    $state['failureStage'] = 'complete'; $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY'; $state['success'] = $true
  } catch {
    $state['innerClassification'] = Get-ValueBlindFailureCode $_ 'R6_CURRENT_CANONICAL_V3_DRY_RUN_UNEXPECTED_FAILURE'
    if ($state['innerClassification'] -eq 'QA_CANARY_CONSUMED_RUN_RECEIPT_BINDING_MISMATCH') { $state['failureStage'] = 'RECEIPT_BINDING_VALIDATION' }
    $state['outerClassification'] = 'R6_CURRENT_CANONICAL_V3_DRY_RUN_FAILED'
  } finally {
    Clear-RunnerEnvironment; $auth=$null; $confirmationHash=$null; Write-CurrentCanonicalProductionV3DryRunTerminal $terminalPath $state
  }
  Invoke-CurrentCanonicalProductionV3DryRunTerminalValidator $terminalPath
  if (-not $state['success']) { throw $state['outerClassification'] }
  return [pscustomobject]@{ Path=$terminalPath; State=$state }
}

function Invoke-PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly([pscustomobject]$Validation) {
  Set-R6WrapperStage 'EVIDENCE_ROOT_VALIDATION'
  $root = Assert-CurrentCanonicalProductionV3EvidenceRoot $EvidenceRoot
  if ($RunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_RUN_ID_INVALID' }
  New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
  $captureTerminalPath = Join-Path $root 'current-canonical-production-v3-metadata-preparation-terminal-result.json'
  $authRoot = Join-Path $root 'auth-check'; $authTerminalPath = Join-Path $authRoot 'auth-check-only-terminal-result.json'
  $dryRoot = Join-Path $root 'dry-run'; $dryTerminalPath = Join-Path $dryRoot 'dry-run-only-terminal-result.json'
  $terminalPath = Join-Path $root 'capture-authcheck-dryrun-orchestration-terminal-result.json'
  $started = Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow)
  $state = [ordered]@{ schemaVersion=$null; startedAt=$started; completedAt=$null; executionCommit=$Validation.Head; worktreeContract='current-canonical-production-v3'; runId=$RunId; outerClassification=$null; innerClassification=$null; success=$false; failureStage='oauth_readiness'; captureAuthorizedByMode=$true; captureStarted=$false; captureCompleted=$false; captureSuccess=$false; captureTerminalPath=$null; captureTerminalSha256=$null; captureOuterClassification=$null; captureInnerClassification=$null; captureChildExitCode=1; capturePagesRequestCount=0; attestationPath=$null; attestationSha256=$null; attestationType=$null; attestationIssuedAt=$null; attestationExpiresAt=$null; authFreshnessCheckedAt=$started; authRemainingValidityMs=0; authMinimumRequiredValidityMs=$script:MinimumAttestationValidityMilliseconds; authAttestationFreshnessPassed=$false; authCheckAuthorizedByMode=$true; authCheckStarted=$false; authCheckCompleted=$false; authCheckSuccess=$false; authenticationCompleted=$false; sessionValidated=$false; authenticatedCheckCompleted=$false; authCheckTerminalPath=$null; authCheckTerminalSha256=$null; authCheckOuterClassification=$null; authCheckInnerClassification=$null; authCheckChildExitCode=1; dryRunFreshnessCheckedAt=$started; dryRunRemainingValidityMs=0; dryRunMinimumRequiredValidityMs=$script:MinimumAttestationValidityMilliseconds; dryRunAttestationFreshnessPassed=$false; dryRunAuthorizedByMode=$true; dryRunStarted=$false; dryRunCompleted=$false; dryRunSuccess=$false; dryRunTerminalPath=$null; dryRunTerminalSha256=$null; dryRunOuterClassification=$null; dryRunInnerClassification=$null; dryRunChildExitCode=1; dryRunExecutionCommit=$null; dryRunReceiptRunnerCommit=$null; dryRunExpectedToolingCommit=$null; dryRunPlannedMutationCount=2; dryRunActualMutationCount=0; targetBinding=$null; targetBindingPath=$null; targetBindingSha256=$null; pagesProjectGetCount=0; deploymentGetCount=0; supabaseReadCount=0; supabaseWriteCount=0; productionMutationCount=0; retryCount=0; dryRunReservationAttempted=$false; dryRunReservationCompleted=$false; dryRunReceiptCreated=$false; dryRunReceiptState='NOT_CREATED_OR_UNCONFIRMED'; dryRunExecutorStarted=$false; dryRunCanaryChildStarted=$false; dryRunExecutorCompleted=$false; dryRunExecutorTimedOut=$false; dryRunJournalCreated=$false; dryRunFinalAuthorizationCreated=$false; dryRunUnexpectedMutationCount=0; dryRunSupabaseWriteCount=0 }
  $state['dryRunAuthenticationCompleted'] = $false
  $state['targetResolutionStarted'] = $false
  $state['targetResolutionCompleted'] = $false
  $state['targetResolutionSucceeded'] = $false
  $state['targetResolutionFailureCategory'] = $null
  $state['targetResultCountClass'] = 'UNKNOWN'
  $state['targetEligibleState'] = 'UNKNOWN'
  $state['canonicalTargetResolved'] = $false
  $state['canonicalCircleIdResolved'] = $false
  $state['canonicalCircleSlugResolved'] = $false
  $state['targetBindingArtifactPresent'] = $false
  $state['targetBindingValidationPassed'] = $false
  $state['targetBindingCreated'] = $false
  $state['targetBindingHashCreated'] = $false
  $state['targetBoundExecutionPlanHashCreated'] = $false
  try {
    Set-R6WrapperStage 'FIXED_BINDING_VALIDATION'
    Assert-CurrentCanonicalProductionV3Bindings
    $state['failureStage']='preflight_secret_environment'; Set-R6WrapperStage 'SECRET_ENVIRONMENT_GUARD'; Assert-NoPreexistingSecrets
    $state['failureStage']='capture'; Set-R6WrapperStage 'CAPTURE_COMMAND_PREPARATION'; $state['captureStarted']=$true
    $fixtureKind = if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1') { 'authcheck-orchestration-success' } else { $null }
    $null = Invoke-PrepareCurrentCanonicalProductionV3AuthDryRunAttestation $Validation -SuppressDownstreamCommands -FixtureKind $fixtureKind -RootAlreadyCreated -MinimumCurrentValidityMilliseconds $script:MinimumAttestationValidityMilliseconds
    Sync-CurrentCanonicalProductionV3OrchestrationCaptureState $state $captureTerminalPath
    if ($state['captureOuterClassification'] -ne 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY' -or $state['captureChildExitCode'] -ne 0) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_CAPTURE_TERMINAL_INVALID' }
    $capture = Read-AttestationJson $captureTerminalPath; $state['captureSuccess']=$true; $state['attestationPath']=[string]$capture.attestationPath; $state['attestationSha256']=[string]$capture.attestationSha256
    $state['failureStage']='auth_freshness'; $attestation=Assert-DeploymentAttestation $state['attestationPath'] $state['attestationSha256']; $state['attestationType']='CLOUDFLARE_PAGES_PROJECT_GET_V3'; $state['attestationIssuedAt']=(Read-AttestationJson $attestation.Path).observedAt; $state['attestationExpiresAt']=Format-StrictUtcTimestamp $attestation.ExpiresAt; $state['authFreshnessCheckedAt']=Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow); $state['authRemainingValidityMs']=Assert-MinimumAttestationValidity $attestation; $state['authAttestationFreshnessPassed']=$true
    $state['failureStage']='auth_check'; $script:DeploymentAttestationPath=$state['attestationPath']; $script:DeploymentAttestationSha256=$state['attestationSha256']; $script:EvidenceRoot=$authRoot; $state['authCheckStarted']=$true; $null=Invoke-CurrentCanonicalProductionV3AuthCheckOnly; Sync-CurrentCanonicalProductionV3OrchestrationAuthState $state $authTerminalPath; Invoke-CurrentCanonicalProductionV3AuthCheckTerminalValidator $authTerminalPath
    if (-not $state['authCheckSuccess'] -or $state['authCheckOuterClassification'] -ne 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK' -or $state['authCheckChildExitCode'] -ne 0) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_AUTH_CHECK_TERMINAL_INVALID' }
    $state['failureStage']='dry_run_freshness'; $state['dryRunFreshnessCheckedAt']=Format-StrictUtcTimestamp (Get-CurrentCanonicalProductionV3UtcNow); $state['dryRunRemainingValidityMs']=Assert-MinimumAttestationValidity $attestation; $state['dryRunAttestationFreshnessPassed']=$true
    $state['failureStage']='dry_run'; $state['dryRunStarted']=$true; $dry=Invoke-CurrentCanonicalProductionV3DryRunOnly $Validation $dryRoot $RunId $state['attestationPath'] $state['attestationSha256']; $dryTerminal=Sync-VerifiedTargetBindingFromDryRunTerminal $state $dry.Path; $state['dryRunCompleted']=$true; $state['dryRunSuccess']=[bool]$dryTerminal.success; $state['dryRunTerminalPath']=$dry.Path; $state['dryRunTerminalSha256']=Get-Sha256 $dry.Path; $state['dryRunOuterClassification']=$dryTerminal.outerClassification; $state['dryRunInnerClassification']=$dryTerminal.innerClassification; $state['dryRunChildExitCode']=[int]$dryTerminal.childExitCode; Sync-CurrentCanonicalProductionV3DryRunLifecycleState $state $dryTerminal
    foreach ($key in @('authenticationCompleted','targetResolutionStarted','targetResolutionCompleted','targetResolutionSucceeded','targetResolutionFailureCategory','targetResultCountClass','targetEligibleState','canonicalTargetResolved','canonicalCircleIdResolved','canonicalCircleSlugResolved','targetBindingArtifactPresent','targetBindingValidationPassed','targetBindingCreated','targetBindingHashCreated','targetBoundExecutionPlanHashCreated')) {
      $destinationKey = if ($key -eq 'authenticationCompleted') { 'dryRunAuthenticationCompleted' } else { $key }
      $state[$destinationKey] = $dryTerminal.$key
    }
    if (-not $state['dryRunSuccess'] -or $state['dryRunOuterClassification'] -ne 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ONLY_READY' -or $state['dryRunChildExitCode'] -ne 0) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_TERMINAL_INVALID' }
    $state['failureStage']='complete'; $state['outerClassification']='R6_CURRENT_CANONICAL_V3_CAPTURE_AUTH_CHECK_AND_DRY_RUN_READY'; $state['success']=$true
  } catch {
    if (Test-Path -LiteralPath $authTerminalPath -PathType Leaf) {
      try {
        Sync-CurrentCanonicalProductionV3OrchestrationAuthState $state $authTerminalPath
        $authFailure = Read-AttestationJson $authTerminalPath
        if (-not [bool]$authFailure.success) { $state['failureStage'] = [string]$authFailure.failureStage }
      } catch {}
    }
    if (Test-Path -LiteralPath $dryTerminalPath -PathType Leaf) {
      try {
        $dryFailure = Sync-VerifiedTargetBindingFromDryRunTerminal $state $dryTerminalPath
        $state['dryRunCompleted'] = $true; $state['dryRunTerminalPath'] = $dryTerminalPath; $state['dryRunTerminalSha256'] = Get-Sha256 $dryTerminalPath
        $state['dryRunOuterClassification'] = $dryFailure.outerClassification; $state['dryRunInnerClassification'] = $dryFailure.innerClassification; $state['dryRunChildExitCode'] = [int]$dryFailure.childExitCode
        Sync-CurrentCanonicalProductionV3DryRunLifecycleState $state $dryFailure
        foreach ($key in @('authenticationCompleted','targetResolutionStarted','targetResolutionCompleted','targetResolutionSucceeded','targetResolutionFailureCategory','targetResultCountClass','targetEligibleState','canonicalTargetResolved','canonicalCircleIdResolved','canonicalCircleSlugResolved','targetBindingArtifactPresent','targetBindingValidationPassed','targetBindingCreated','targetBindingHashCreated','targetBoundExecutionPlanHashCreated')) {
          $destinationKey = if ($key -eq 'authenticationCompleted') { 'dryRunAuthenticationCompleted' } else { $key }
          $state[$destinationKey] = $dryFailure.$key
        }
        $state['failureStage'] = [string]$dryFailure.failureStage
      } catch {}
    }
    $state['innerClassification']=if (-not [string]::IsNullOrWhiteSpace([string]$state['dryRunInnerClassification'])) { [string]$state['dryRunInnerClassification'] } elseif (-not [string]::IsNullOrWhiteSpace([string]$state['authCheckInnerClassification'])) { [string]$state['authCheckInnerClassification'] } else { Get-ValueBlindFailureCode $_ 'R6_CURRENT_CANONICAL_V3_DRY_RUN_UNEXPECTED_FAILURE' }
    if ($state['failureStage'] -eq 'auth_freshness') { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_AUTH_FRESHNESS_INSUFFICIENT' }
    elseif ($state['failureStage'] -eq 'dry_run_freshness') { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FRESHNESS_INSUFFICIENT' }
    elseif ($state['failureStage'] -eq 'auth_check' -or $state['failureStage'] -match '^AUTH_PASSWORD_GRANT_') { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_AUTH_CHECK_FAILED' }
    elseif ($state['dryRunStarted'] -and $state['dryRunCompleted']) { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED' }
    elseif ($state['failureStage'] -eq 'dry_run' -or $state['failureStage'] -match '^(RUN_ID_|RECEIPT_|MINIMAL_CANARY_)') { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_DRY_RUN_FAILED' }
    elseif ($state['failureStage'] -eq 'preflight_secret_environment') { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_PRE_FLIGHT_UNSAFE' }
    elseif ($state['failureStage'] -eq 'capture') { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_CAPTURE_FAILED' }
    else { $state['outerClassification']='R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_UNEXPECTED_FAILURE' }
  } finally { Write-CurrentCanonicalProductionV3DryRunOrchestrationTerminal $terminalPath $state }
  Invoke-CurrentCanonicalProductionV3DryRunOrchestrationTerminalValidator $terminalPath
  if (-not $state['success']) { throw $state['outerClassification'] }
  Write-Output $state['outerClassification']
}

function Invoke-CurrentCanonicalProductionV3FixtureTest([pscustomobject]$Validation) {
  if ($env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -ne '1') { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE_REQUIRED' }
  if (-not (Test-WindowsFullyQualifiedPath $V3TerminalFixturePath) -or -not (Test-Path -LiteralPath $V3TerminalFixturePath -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_INVALID' }
  $root = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($V3TerminalFixturePath))
  if ($root -notlike "$([IO.Path]::GetTempPath().TrimEnd('\'))*") { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_INVALID' }
  $result = Invoke-CurrentCanonicalProductionV3TerminalValidator $Validation $V3TerminalFixturePath $root
  if ($result -eq 'R6_CURRENT_CANONICAL_V3_TERMINAL_SUCCESS') { Write-Output 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_SUCCESS'; return }
  $terminal = Read-AttestationJson $V3TerminalFixturePath
  throw ([string]$terminal.outerClassification)
}

function Test-ServiceRoleLookingKey([string]$Key) {
  if ($Key -match '(?i)service[_-]?role') { return $true }
  $parts = $Key.Split('.')
  if ($parts.Count -ne 3) { return $false }
  try {
    $payload = $parts[1].Replace('-', '+').Replace('_', '/')
    while (($payload.Length % 4) -ne 0) { $payload += '=' }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
    return $json -match '"role"\s*:\s*"service_role"'
  } catch { return $false }
}

function Get-Mode {
  $selected = @($ValidateOnly, $AuthCheckOnly, $DryRunOnly, $ExecuteApprovedPhase, $PrepareAuthDryRunAttestation, $PreparePagesProjectAuthDryRunAttestation, $PreparePagesProjectR2AuthDryRunAttestation, $PrepareCurrentCanonicalProductionV3AuthDryRunAttestation, $PrepareCurrentCanonicalProductionV3AndAuthCheckOnly, $PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly, $PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight | Where-Object { $_ })
  if ($selected.Count -ne 1) { throw 'R6_MODE_REQUIRED_EXACTLY_ONCE' }
  if ($ValidateOnly) { return 'ValidateOnly' }
  if ($AuthCheckOnly) { return 'AuthCheckOnly' }
  if ($DryRunOnly) { return 'DryRunOnly' }
  if ($PrepareAuthDryRunAttestation) { return 'PrepareAuthDryRunAttestation' }
  if ($PreparePagesProjectAuthDryRunAttestation) { return 'PreparePagesProjectAuthDryRunAttestation' }
  if ($PreparePagesProjectR2AuthDryRunAttestation) { return 'PreparePagesProjectR2AuthDryRunAttestation' }
  if ($PrepareCurrentCanonicalProductionV3AuthDryRunAttestation) { return 'PrepareCurrentCanonicalProductionV3AuthDryRunAttestation' }
  if ($PrepareCurrentCanonicalProductionV3AndAuthCheckOnly) { return 'PrepareCurrentCanonicalProductionV3AndAuthCheckOnly' }
  if ($PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly) { return 'PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly' }
  if ($PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight) { return 'PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight' }
  return 'ExecuteApprovedPhase'
}

function Assert-PhaseApproval([string]$Value) {
  if (-not [string]::Equals($Value, $script:FuturePhaseApproval, [StringComparison]::Ordinal)) {
    throw 'R6_FRESH_PHASE_APPROVAL_REQUIRED'
  }
}

function Get-ExpectedJournalRoot {
  return 'C:\Users\1\OpenGlassHub-R6-Proof\production-canary'
}

function Get-ConfirmationHash([System.Security.SecureString]$Value) {
  $plaintext = $null
  try {
    $plaintext = Convert-SecureStringToPlaintext $Value
    if ([string]::IsNullOrWhiteSpace($plaintext)) { throw 'R6_CONFIRMATION_TOKEN_REQUIRED' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($plaintext)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ($algorithm.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '' }
    finally { $algorithm.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length) }
  } finally { $plaintext = $null; $Value.Dispose() }
}

function Get-ChildCommandDigest([ValidateSet('dry-run', 'live')][string]$Domain, [string]$RequestedRunId) {
  $arguments = if ($Domain -eq 'dry-run') { @('node', $script:RunnerRelativePath, '--dry-run', '--run-id', $RequestedRunId, '--confirm-run', $RequestedRunId) } else { @('node', $script:RunnerRelativePath, '--execute', '--run-id', $RequestedRunId, '--confirm-run', $RequestedRunId) }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($arguments -join "`n"))
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return (($algorithm.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally { $algorithm.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Invoke-ConsumedRunTool([string]$Worktree, [string[]]$Arguments) {
  Push-Location -LiteralPath $Worktree
  try {
    $lines = @(& node $script:ConsumedRunToolRelativePath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { Pop-Location }
  if ($exitCode -ne 0) {
    $safe = @($lines | ForEach-Object { [string]$_ } | Where-Object { $_ -notmatch '(?i)(token|password|authorization|apikey|cookie)' }) -join ' | '
    if ($safe -match 'ENOENT|HISTORICAL_LEDGER_MISSING|REGISTRY_MISSING') { throw 'R6_CONSUMED_RUN_REGISTRY_BACKFILL_REQUIRED' }
    if ($safe -match 'QA_CANARY_RUN_ID_ALREADY_CONSUMED') { throw 'QA_CANARY_RUN_ID_ALREADY_CONSUMED' }
    throw "R6_CONSUMED_RUN_TOOL_FAILED:$safe"
  }
  if ($lines.Count -ne 1) { throw 'R6_CONSUMED_RUN_TOOL_OUTPUT_INVALID' }
  try { return ($lines[0] | ConvertFrom-Json) } catch { throw 'R6_CONSUMED_RUN_TOOL_OUTPUT_INVALID' }
}

function Assert-RunIdEligible([string]$Worktree, [string]$RequestedRunId) {
  if ($RequestedRunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'R6_RUN_ID_INVALID' }
  $result = Invoke-ConsumedRunTool $Worktree @('--registry-root', $script:ConsumedRunRegistryRoot, '--run-id', $RequestedRunId, '--verify')
  if ([string]$result.runId -ne $RequestedRunId) { throw 'R6_CONSUMED_RUN_TOOL_OUTPUT_INVALID' }
  return $result
}

function Assert-RunIdJournalAbsent([string]$RequestedRunId) {
  $journal = Join-Path (Join-Path (Get-ExpectedJournalRoot) $RequestedRunId) 'journal.json'
  if (Test-Path -LiteralPath $journal) { throw 'R6_RUN_ID_JOURNAL_EXISTS' }
}

function Get-ValidatedExecutionCommit([pscustomobject]$Validation) {
  if ($null -eq $Validation -or [string]::IsNullOrWhiteSpace([string]$Validation.Path) -or [string]$Validation.Head -notmatch '^[a-f0-9]{40}$') { throw 'R6_EXECUTION_COMMIT_BINDING_INVALID' }
  $head = Invoke-GitLines ([string]$Validation.Path) @('rev-parse', 'HEAD')
  if ($head.Lines.Count -ne 1 -or $head.Lines[0].Trim().ToLowerInvariant() -ne [string]$Validation.Head) { throw 'R6_EXECUTION_COMMIT_CHANGED' }
  return [string]$Validation.Head
}

function Reserve-ConsumedRun([pscustomobject]$Validation, [string]$RequestedRunId, [ValidateSet('dry-run', 'live')][string]$Domain, [string]$ConfirmationHash, [string]$FinalAuthorizationBindingPath = '', [string]$FinalAuthorizationBindingSha256 = '', [string]$TargetBindingPath = '') {
  $runnerCommit = Get-ValidatedExecutionCommit $Validation
  $wrapperHash = Get-Sha256 $script:WrapperPath
  $childCommandDigest = Get-ChildCommandDigest $Domain $RequestedRunId
  $arguments = @('--registry-root', $script:ConsumedRunRegistryRoot, '--run-id', $RequestedRunId, '--mode', $Domain, '--confirmation-token-sha256', $ConfirmationHash, '--runner-commit', $runnerCommit, '--wrapper-version', $script:ConsumedRunWrapperVersion, '--wrapper-sha256', $wrapperHash, '--child-command-digest', $childCommandDigest)
  if (-not [string]::IsNullOrWhiteSpace($FinalAuthorizationBindingPath) -or -not [string]::IsNullOrWhiteSpace($FinalAuthorizationBindingSha256)) {
    if ($Domain -ne 'live' -or -not (Test-WindowsFullyQualifiedPath $FinalAuthorizationBindingPath) -or -not (Test-Path -LiteralPath $FinalAuthorizationBindingPath -PathType Leaf) -or $FinalAuthorizationBindingSha256 -notmatch '^[a-f0-9]{64}$' -or (Get-Sha256 $FinalAuthorizationBindingPath) -ne $FinalAuthorizationBindingSha256) { throw 'R6_FINAL_AUTHORIZATION_BINDING_INVALID' }
    $arguments += @('--final-authorization-binding', $FinalAuthorizationBindingPath, '--attestation-sha256', $script:CurrentExecutionAttestationSha256)
  }
  if (-not [string]::IsNullOrWhiteSpace($TargetBindingPath)) {
    if ($Domain -ne 'dry-run' -or -not (Test-WindowsFullyQualifiedPath $TargetBindingPath) -or -not (Test-Path -LiteralPath $TargetBindingPath -PathType Leaf)) { throw 'QA_CANARY_TARGET_BINDING_INVALID' }
    $arguments += @('--target-binding', $TargetBindingPath)
  }
  $result = Invoke-ConsumedRunTool ([string]$Validation.Path) $arguments
  if ([string]::IsNullOrWhiteSpace([string]$result.receiptPath) -or [string]$result.receiptSha256 -notmatch '^[a-f0-9]{64}$' -or [string]$result.invocationNonce -notmatch '^[a-f0-9-]{36}$') { throw 'R6_CONSUMED_RUN_RESERVATION_OUTPUT_INVALID' }
  return [pscustomobject]@{ RegistryRoot = $script:ConsumedRunRegistryRoot; ReceiptPath = [string]$result.receiptPath; ReceiptSha256 = [string]$result.receiptSha256; InvocationNonce = [string]$result.invocationNonce; RunnerCommit = $runnerCommit; WrapperSha256 = $wrapperHash; ChildCommandDigest = $childCommandDigest }
}

function Assert-ExecutionWorktree([string]$Worktree, [string]$RequestedRunId) {
  $resolved = (Resolve-Path -LiteralPath $Worktree -ErrorAction Stop).Path.TrimEnd('\\')
  $expected = (Resolve-Path -LiteralPath $script:ExpectedExecutionWorktree -ErrorAction Stop).Path.TrimEnd('\\')
  if (-not $resolved.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'R6_EXECUTION_WORKTREE_PATH_REJECTED' }
  $gitRoot = Invoke-GitLines $resolved @('rev-parse', '--show-toplevel')
  if ($gitRoot.Lines.Count -ne 1) { throw 'R6_EXECUTION_WORKTREE_NOT_GIT' }
  $status = Invoke-GitLines $resolved @('status', '--porcelain=v1', '--untracked-files=all')
  if ($status.Lines.Count -ne 0) { throw ('R6_EXECUTION_WORKTREE_DIRTY:' + ($status.Lines -join ' | ')) }
  $head = Invoke-GitLines $resolved @('rev-parse', 'HEAD')
  if ($head.Lines.Count -ne 1 -or $head.Lines[0].Trim() -ne $script:ExpectedRunnerCommit) { throw 'R6_EXECUTION_COMMIT_MISMATCH' }
  $branch = Invoke-GitLines $resolved @('symbolic-ref', '-q', '--short', 'HEAD') -AllowFailure
  if ($branch.ExitCode -eq 0 -or $branch.Lines.Count -ne 0) { throw 'R6_EXECUTION_HEAD_NOT_DETACHED' }
  foreach ($entry in $script:ReviewedHashes.GetEnumerator()) {
    $actual = Get-Sha256 (Join-Path $resolved $entry.Key)
    if ($actual -ne $entry.Value) { throw "R6_REVIEWED_HASH_MISMATCH:$($entry.Key)" }
  }
  foreach ($entry in $script:ReviewedGitBlobHashes.GetEnumerator()) {
    $relativePath = $entry.Key.Replace('\', '/')
    $blob = Invoke-GitLines $resolved @('rev-parse', "$($script:ExpectedRunnerCommit):$relativePath")
    if ($blob.Lines.Count -ne 1 -or $blob.Lines[0].Trim() -ne $entry.Value) { throw "R6_REVIEWED_GIT_BLOB_MISMATCH:$($entry.Key)" }
    $headBlob = Invoke-GitLines $resolved @('rev-parse', "HEAD:$relativePath")
    if ($headBlob.Lines.Count -ne 1 -or $headBlob.Lines[0].Trim() -ne $entry.Value) { throw "R6_RUNTIME_GIT_BLOB_MISMATCH:$($entry.Key)" }
  }
  if (-not [string]::IsNullOrWhiteSpace($RequestedRunId)) {
    if ($RequestedRunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'R6_RUN_ID_INVALID' }
  }
  return [pscustomobject]@{ Path = $resolved; Head = $head.Lines[0].Trim(); Detached = $true; JournalRoot = Get-ExpectedJournalRoot }
}

function Get-FinalExecutionBinding([string]$BindingPath, [string]$BindingSha256, [string]$Worktree) {
  if (-not (Test-WindowsFullyQualifiedPath $BindingPath) -or -not (Test-Path -LiteralPath $BindingPath -PathType Leaf) -or $BindingSha256 -notmatch '^[a-f0-9]{64}$' -or (Get-Sha256 $BindingPath) -ne $BindingSha256) { throw 'R6_FINAL_LOCAL_BINDING_INVALID' }
  $validator = Join-Path $Worktree 'scripts\qa\validate-r6-final-execution-binding.mjs'
  if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) { throw 'R6_FINAL_LOCAL_BINDING_VALIDATOR_MISSING' }
  $previous = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $lines = @(& node $validator '--binding' $BindingPath '--sha256' $BindingSha256); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  if ($exitCode -ne 0 -or $lines.Count -ne 1) { throw 'R6_FINAL_LOCAL_BINDING_INVALID' }
  try { $binding = $lines[0] | ConvertFrom-Json -ErrorAction Stop } catch { throw 'R6_FINAL_LOCAL_BINDING_INVALID' }
  return $binding
}

function Assert-FinalExecutionWorktree([string]$Worktree, [pscustomobject]$Binding, [string]$RequestedRunId) {
  if ($null -eq $Binding) { throw 'R6_FINAL_LOCAL_BINDING_REQUIRED' }
  foreach ($name in @('executionWorktree','executionCommit','runnerCommit','toolingCommit','wrapperPath','wrapperSha256','finalContractGitBlob','executeRunnerGitBlob','postflightRunnerGitBlob','bindingValidatorGitBlob','bindingLibraryGitBlob','parentDryRunRunId')) {
    if ($null -eq $Binding.PSObject.Properties[$name] -or [string]::IsNullOrWhiteSpace([string]$Binding.PSObject.Properties[$name].Value)) { throw 'R6_FINAL_LOCAL_BINDING_REQUIRED' }
  }
  $resolved = (Resolve-Path -LiteralPath $Worktree -ErrorAction Stop).Path.TrimEnd('\\')
  $expected = (Resolve-Path -LiteralPath ([string]$Binding.executionWorktree) -ErrorAction Stop).Path.TrimEnd('\\')
  if (-not $resolved.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'R6_FINAL_EXECUTION_WORKTREE_PATH_REJECTED' }
  if (Test-Path -LiteralPath (Join-Path $resolved 'node_modules')) { throw 'R6_FINAL_EXECUTION_NODE_MODULES_PRESENT' }
  $gitRoot = Invoke-GitLines $resolved @('rev-parse', '--show-toplevel')
  $gitCanonicalRoot = if ($gitRoot.Lines.Count -eq 1) { [IO.Path]::GetFullPath($gitRoot.Lines[0].Trim()).TrimEnd('\\') } else { '' }
  if ($gitRoot.Lines.Count -ne 1 -or -not $gitCanonicalRoot.Equals($resolved, [StringComparison]::OrdinalIgnoreCase)) { throw 'R6_FINAL_EXECUTION_WORKTREE_NOT_GIT' }
  $status = Invoke-GitLines $resolved @('status', '--porcelain=v1', '--untracked-files=all')
  if ($status.Lines.Count -ne 0) { throw ('R6_FINAL_EXECUTION_WORKTREE_DIRTY:' + ($status.Lines -join ' | ')) }
  $head = Invoke-GitLines $resolved @('rev-parse', 'HEAD')
  if ($head.Lines.Count -ne 1 -or $head.Lines[0].Trim() -ne [string]$Binding.executionCommit -or [string]$Binding.runnerCommit -ne [string]$Binding.executionCommit -or [string]$Binding.toolingCommit -ne [string]$Binding.executionCommit) { throw 'R6_FINAL_EXECUTION_COMMIT_MISMATCH' }
  $branch = Invoke-GitLines $resolved @('symbolic-ref', '-q', '--short', 'HEAD') -AllowFailure
  if ($branch.ExitCode -eq 0 -or $branch.Lines.Count -ne 0) { throw 'R6_FINAL_EXECUTION_HEAD_NOT_DETACHED' }
  if ((Resolve-Path -LiteralPath ([string]$Binding.wrapperPath) -ErrorAction Stop).Path -ne (Resolve-Path -LiteralPath $script:WrapperPath -ErrorAction Stop).Path -or (Get-Sha256 $script:WrapperPath) -ne [string]$Binding.wrapperSha256) { throw 'R6_FINAL_WRAPPER_BINDING_MISMATCH' }
  $blobBindings = [ordered]@{
    'scripts/qa/r6-final-canary-execution-contract.mjs' = [string]$Binding.finalContractGitBlob
    'scripts/qa/run-production-minimal-canary.mjs' = [string]$Binding.executeRunnerGitBlob
    'scripts/qa/run-r6-final-canary-read-only-postflight.mjs' = [string]$Binding.postflightRunnerGitBlob
    'scripts/qa/validate-r6-final-execution-binding.mjs' = [string]$Binding.bindingValidatorGitBlob
    'scripts/qa/r6-final-execution-binding.mjs' = [string]$Binding.bindingLibraryGitBlob
  }
  foreach ($entry in $blobBindings.GetEnumerator()) {
    $blob = Invoke-GitLines $resolved @('rev-parse', "HEAD:$($entry.Key)")
    if ($blob.Lines.Count -ne 1 -or $blob.Lines[0].Trim() -ne $entry.Value) { throw "R6_FINAL_GIT_BLOB_MISMATCH:$($entry.Key)" }
  }
  if ($RequestedRunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or $RequestedRunId -eq [string]$Binding.parentDryRunRunId) { throw 'R6_FINAL_PRODUCTION_RUN_ID_INVALID' }
  return [pscustomobject]@{ Path = $resolved; Head = $head.Lines[0].Trim(); Detached = $true; JournalRoot = Get-ExpectedJournalRoot; Binding = $Binding }
}

function Assert-FinalParentDryRunAuthorization([pscustomobject]$Binding, [string]$ProductionRunId) {
  if (-not (Test-WindowsFullyQualifiedPath ([string]$Binding.parentAuthorizationPath)) -or -not (Test-Path -LiteralPath ([string]$Binding.parentAuthorizationPath) -PathType Leaf) -or (Get-Sha256 ([string]$Binding.parentAuthorizationPath)) -ne [string]$Binding.parentAuthorizationSha256) { throw 'R6_PARENT_DRY_RUN_AUTHORIZATION_INVALID' }
  if (-not (Test-WindowsFullyQualifiedPath ([string]$Binding.parentReceiptPath)) -or -not (Test-Path -LiteralPath ([string]$Binding.parentReceiptPath) -PathType Leaf) -or (Get-Sha256 ([string]$Binding.parentReceiptPath)) -ne [string]$Binding.parentReceiptSha256) { throw 'R6_PARENT_DRY_RUN_RECEIPT_INVALID' }
  $receipt = Read-AttestationJson ([string]$Binding.parentReceiptPath)
  if ([string]$receipt.state -ne 'CONSUMED' -or [string]$receipt.runId -ne [string]$Binding.parentDryRunRunId -or [string]$receipt.runnerCommit -ne [string]$Binding.executionCommit) { throw 'R6_PARENT_DRY_RUN_RECEIPT_INVALID' }
  $authorization = Read-AttestationJson ([string]$Binding.parentAuthorizationPath)
  if ([string]$authorization.dryRunRunId -ne [string]$Binding.parentDryRunRunId -or [string]$authorization.executionCommit -ne [string]$Binding.executionCommit -or [string]$authorization.toolingCommit -ne [string]$Binding.toolingCommit -or [string]$authorization.plan.schemaVersion -ne [string]$Binding.planSchema -or [string]$authorization.plan.planSha256 -ne [string]$Binding.planSha256 -or [int]$authorization.plannedMutationCount -ne [int]$Binding.plannedMutationCount -or [int]$authorization.actualMutationCount -ne [int]$Binding.parentActualMutationCount) { throw 'R6_PARENT_DRY_RUN_AUTHORIZATION_INVALID' }
  foreach ($name in @('dryRunTerminalPath','dryRunTerminalSha256','dryRunOrchestrationTerminalPath','dryRunOrchestrationTerminalSha256')) {
    if ($null -eq $authorization.PSObject.Properties[$name] -or [string]::IsNullOrWhiteSpace([string]$authorization.PSObject.Properties[$name].Value)) { throw 'R6_PARENT_DRY_RUN_AUTHORIZATION_INVALID' }
  }
  if (-not (Test-Path -LiteralPath ([string]$authorization.dryRunTerminalPath) -PathType Leaf) -or -not (Test-Path -LiteralPath ([string]$authorization.dryRunOrchestrationTerminalPath) -PathType Leaf) -or (Get-Sha256 ([string]$authorization.dryRunTerminalPath)) -ne [string]$authorization.dryRunTerminalSha256 -or (Get-Sha256 ([string]$authorization.dryRunOrchestrationTerminalPath)) -ne [string]$authorization.dryRunOrchestrationTerminalSha256) { throw 'R6_PARENT_DRY_RUN_AUTHORIZATION_INVALID' }
  return $authorization
}

function Test-PathContainedWithin([string]$Root, [string]$Candidate) {
  $normalizedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $normalizedCandidate = [IO.Path]::GetFullPath($Candidate)
  $prefix = $normalizedRoot + [IO.Path]::DirectorySeparatorChar
  return $normalizedCandidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-WindowsFullyQualifiedPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or -not [IO.Path]::IsPathRooted($Value)) { return $false }
  return [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Value)) -match '^[A-Za-z]:\\$'
}

function Read-AttestationJson([string]$Path) {
  $raw = Get-Content -LiteralPath $Path -Raw
  if ($PSVersionTable.PSVersion.Major -ge 7) {
    return ($raw | ConvertFrom-Json -DateKind String)
  }
  Add-Type -AssemblyName System.Web.Extensions
  $parsed = [System.Web.Script.Serialization.JavaScriptSerializer]::new().DeserializeObject($raw)
  if (-not ($parsed -is [System.Collections.IDictionary])) { throw 'R6_ATTESTATION_JSON_INVALID' }
  $properties = [ordered]@{}
  foreach ($key in $parsed.Keys) { $properties[[string]$key] = $parsed[$key] }
  return [pscustomobject]$properties
}

function Get-OptionalJsonProperty([object]$Value, [string]$Name) {
  if ($Value -is [System.Collections.IDictionary]) {
    if ($Value.Contains($Name)) { return $Value[$Name] }
    return $null
  }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Assert-DeploymentAttestation([string]$Path, [string]$ExpectedHash) {
  if ($ExpectedHash -notmatch '^[a-f0-9]{64}$') { throw 'R6_ATTESTATION_HASH_INVALID' }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'R6_ATTESTATION_MISSING' }
  $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  $attestationRoot = $script:ExpectedAttestationRoot
  if ($env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -eq '1') {
    $attestationRoot = [string]$env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_ATTESTATION_ROOT
    if (-not (Test-WindowsFullyQualifiedPath $attestationRoot) -or $attestationRoot -notlike "$([IO.Path]::GetTempPath().TrimEnd('\'))*") { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_INVALID' }
  }
  $root = (Resolve-Path -LiteralPath $attestationRoot -ErrorAction Stop).Path.TrimEnd('\\')
  if (-not (Test-PathContainedWithin $root $resolved)) { throw 'R6_ATTESTATION_PATH_REJECTED' }
  if ((Get-Item -LiteralPath $resolved -Force).LinkType) { throw 'R6_ATTESTATION_REPARSE_REJECTED' }
  $actualHash = Get-Sha256 $resolved
  if ($actualHash -ne $ExpectedHash) { throw 'R6_ATTESTATION_HASH_MISMATCH' }
  try { $value = Read-AttestationJson $resolved } catch { throw 'R6_ATTESTATION_JSON_INVALID' }
  if ($value.schemaVersion -ne 'r6-production-deployment-attestation-v1' -or $value.provider -ne 'cloudflare-pages' -or $value.projectName -ne 'openglasshub' -or $value.environment -ne 'production') { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
  if ($value.canonicalBaseUrl -ne $script:ExpectedBaseUrl -or $value.sourceCommit -ne $script:ExpectedDeployedCommit -or $value.targetIdentityHash -ne $script:ExpectedTargetIdentityHash -or $value.classification -ne 'PRODUCTION_DEPLOYMENT_IDENTITY_EXACT') { throw 'R6_ATTESTATION_TARGET_MISMATCH' }
  if ($value.immutableDeploymentUrl -notmatch '^https://[a-z0-9-]+\.openglasshub\.pages\.dev/$' -or [string]::IsNullOrWhiteSpace([string]$value.deploymentId)) { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
  if ($null -ne $value.evidenceType -and $value.evidenceType -ne 'CLOUDFLARE_PAGES_DEPLOYMENT_GET_V1' -and $value.evidenceType -ne 'CLOUDFLARE_PAGES_PROJECT_GET_V1' -and $value.evidenceType -ne 'CLOUDFLARE_PAGES_PROJECT_GET_V2' -and $value.evidenceType -ne 'CLOUDFLARE_PAGES_PROJECT_GET_V3') { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
  if ($value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V1') {
    if ($value.toolingCommit -ne $script:ExpectedRunnerCommit -or $value.wrapperSha256 -ne (Get-Sha256 $script:WrapperPath) -or $value.projectSourceContractSha256 -ne '7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0') { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
    if ($value.productionBranch -ne 'main' -or $value.triggerBranch -ne 'main' -or $value.isSkipped -ne $false -or $value.latestStageName -ne 'deploy' -or $value.latestStageStatus -ne 'success') { throw 'R6_ATTESTATION_TARGET_MISMATCH' }
    foreach ($digest in @($value.transportSha256, $value.parserSelectorSha256, $value.endpointSha256, $value.accountIdSha256, $value.sanitizedMetadataSha256)) { if ([string]$digest -notmatch '^[a-f0-9]{64}$') { throw 'R6_ATTESTATION_SCHEMA_INVALID' } }
  }
  if ($value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V2' -or $value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V3') {
    $expectedToolingCommit = if ($value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V3') { $script:V3FinalCommitBinding } else { $script:ExpectedRunnerCommit }
    if ($value.toolingCommit -ne $expectedToolingCommit -or $value.wrapperSha256 -ne (Get-Sha256 $script:WrapperPath) -or $value.wrapperVersion -ne 'r6-consumed-run-wrapper-v1') { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
    $expectedNormalizationVersion = if ($value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V3') { 'canonical-deployment-url-v2-observed-current' } else { 'canonical-deployment-url-v1' }
    if ($value.immutableDeploymentUrlNormalizationVersion -ne $expectedNormalizationVersion) { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
    if ($value.productionBranch -ne 'main' -or $value.triggerBranch -ne 'main' -or $value.isSkipped -ne $false -or $value.latestStageName -ne 'deploy' -or $value.latestStageStatus -ne 'success' -or $value.projectName -ne 'openglasshub' -or $value.canonicalDeploymentProjectName -ne 'openglasshub' -or $value.canonicalDeploymentProjectId -ne $value.projectId) { throw 'R6_ATTESTATION_TARGET_MISMATCH' }
    if ($value.aliasesObservedType -eq 'array') {
      if ($value.canonicalTargetProofMode -ne 'CANONICAL_DEPLOYMENT_ALIASES_V1' -or $value.canonicalAlias -ne $script:ExpectedBaseUrl -or ($null -ne $value.projectSubdomain -and $value.projectSubdomain -ne 'openglasshub.pages.dev')) { throw 'R6_ATTESTATION_TARGET_MISMATCH' }
    } elseif ($value.aliasesObservedType -eq 'null') {
      $canonicalAlias = Get-OptionalJsonProperty $value 'canonicalAlias'
      if ($value.canonicalTargetProofMode -ne 'PROJECT_SUBDOMAIN_PRODUCTION_BINDING_V1' -or $null -ne $canonicalAlias -or $value.projectSubdomain -ne 'openglasshub.pages.dev') { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
    } else { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
    $expectedSourceHashes = @('7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0','10d35dd1fa3d42e48a0abf9b585d93673941f5336fa18f66bec09d2d222c0793','2ab54ab5f18040ec80caeaa2dea7cd202f3f696ac4b589fc4874282a74590d63','d663755d742e7f75c22a6aa77ddda4fb9401ae23815b7d50a23d0f80be4b771d','89beea55ff2cee9ffeac79703ee56558761dbbbe34dc68d52a2a7e563519b27e')
    $actualSourceHashes = @($value.projectSourceContractSha256s | ForEach-Object { [string]$_ })
    if ($actualSourceHashes.Count -ne $expectedSourceHashes.Count) { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
    for ($index = 0; $index -lt $expectedSourceHashes.Count; $index++) { if ($actualSourceHashes[$index] -ne $expectedSourceHashes[$index]) { throw 'R6_ATTESTATION_SCHEMA_INVALID' } }
    foreach ($digest in @($value.transportSha256, $value.parserSelectorSha256, $value.endpointSha256, $value.accountIdSha256, $value.sanitizedMetadataSha256)) { if ([string]$digest -notmatch '^[a-f0-9]{64}$') { throw 'R6_ATTESTATION_SCHEMA_INVALID' } }
  }
  if ([string]$value.observedAt -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' -or [string]$value.expiresAt -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$') { throw 'R6_ATTESTATION_TIME_INVALID' }
  try {
    $observed = Convert-StrictUtcTimestamp ([string]$value.observedAt) 'R6_ATTESTATION_TIME_INVALID'
    $expires = Convert-StrictUtcTimestamp ([string]$value.expiresAt) 'R6_ATTESTATION_TIME_INVALID'
  } catch { throw 'R6_ATTESTATION_TIME_INVALID' }
  $now = Get-CurrentCanonicalProductionV3UtcNow
  if ($observed.Offset -ne [TimeSpan]::Zero -or $expires.Offset -ne [TimeSpan]::Zero -or $observed -gt $now -or $expires -le $observed -or ($expires - $observed).TotalMinutes -gt 15 -or $expires -lt $now) { throw 'R6_ATTESTATION_STALE' }
  return [pscustomobject]@{ Path = $resolved; Sha256 = $actualHash; DeploymentId = [string]$value.deploymentId; SourceCommit = [string]$value.sourceCommit; ExpiresAt = $expires }
}

function Assert-MinimumAttestationValidity([pscustomobject]$Attestation) {
  $remaining = ($Attestation.ExpiresAt - (Get-CurrentCanonicalProductionV3UtcNow)).TotalMilliseconds
  if ($remaining -lt $script:MinimumAttestationValidityMilliseconds) { throw 'R6_ATTESTATION_VALIDITY_TOO_SHORT' }
  return [math]::Floor($remaining)
}

function Write-SanitizedEvidence([string]$Root, [string]$Name, [hashtable]$Data) {
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  foreach ($key in $Data.Keys) {
    if ([string]$key -match '(?i)(password|access[_-]?token|refresh[_-]?token|authorization|anon[_-]?key)') {
      throw 'R6_EVIDENCE_SECRET_PATTERN_REJECTED'
    }
  }
  $file = Join-Path $Root $Name
  $json = $Data | ConvertTo-Json -Depth 6
  if ($json -match '(?i)(password|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]\s*[^\[\"]') { throw 'R6_EVIDENCE_SECRET_PATTERN_REJECTED' }
  [IO.File]::WriteAllText($file, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  return $file
}

function Get-FutureInputs([switch]$IncludeDryRunTarget) {
  Assert-TranscriptSafe
  Set-OperatorLauncherStage 'READ_SUPABASE_PROJECT_REF'
  $projectRef = Assert-ProjectRef (Read-Host 'Production Supabase project ref')
  Set-OperatorLauncherStage 'READ_SUPABASE_PUBLIC_KEY'
  $anonSecure = Read-Host 'Production anon/public key (hidden)' -AsSecureString
  Set-OperatorLauncherStage 'READ_QA_EMAIL'
  $email = Assert-NonBlank (Read-Host 'Dedicated QA email') 'qa-email'
  Write-Host 'Enter the OpenGlass Hub / Supabase QA account password (not the mailbox password).' -ForegroundColor Yellow
  Set-OperatorLauncherStage 'READ_QA_PASSWORD'
  $passwordSecure = Read-Host 'OpenGlass Hub / Supabase QA account password (not mailbox password)' -AsSecureString
  if ($IncludeDryRunTarget) { Set-OperatorLauncherStage 'READ_TARGET_SLUG' }
  $requestedCircleSlug = if ($IncludeDryRunTarget) { Assert-CircleSlug (Read-Host 'Approved existing circle slug for fresh DryRun target resolution') } else { $null }
  return [pscustomobject]@{ ProjectRef = $projectRef; AnonSecure = $anonSecure; Email = $email; PasswordSecure = $passwordSecure; RequestedCircleSlug = $requestedCircleSlug }
}

function Get-AuthProviderRejectionDetails([string]$Candidate) {
  $fallback = [pscustomobject]@{ ReasonClass = 'not_observed'; Recognized = $false }
  if ([string]::IsNullOrWhiteSpace($Candidate) -or $Candidate.Length -gt 4096) { return $fallback }
  try {
    $parsed = $Candidate | ConvertFrom-Json -ErrorAction Stop
    $value = $null
    foreach ($name in @('code','error','error_code','status')) {
      if ($null -ne $parsed.PSObject.Properties[$name] -and -not [string]::IsNullOrWhiteSpace([string]$parsed.$name)) { $value = ([string]$parsed.$name).Trim().ToLowerInvariant(); break }
    }
    switch ($value) {
      { $_ -in @('invalid_grant','invalid_credentials','invalid_login_credentials','user_not_found') } { return [pscustomobject]@{ ReasonClass = 'credential_rejection'; Recognized = $true } }
      { $_ -in @('email_not_confirmed','email_confirmation_required') } { return [pscustomobject]@{ ReasonClass = 'email_confirmation_required'; Recognized = $true } }
      { $_ -in @('user_disabled','user_banned','account_disabled','account_banned') } { return [pscustomobject]@{ ReasonClass = 'account_disabled_or_banned'; Recognized = $true } }
      { $_ -in @('invalid_api_key','invalid_anon_key','api_key_invalid','project_mismatch') } { return [pscustomobject]@{ ReasonClass = 'project_or_public_key_rejection'; Recognized = $true } }
      { $_ -in @('captcha_required','verification_required','security_challenge_required') } { return [pscustomobject]@{ ReasonClass = 'verification_required'; Recognized = $true } }
      { $_ -in @('rate_limit','rate_limited','too_many_requests') } { return [pscustomobject]@{ ReasonClass = 'rate_limited'; Recognized = $true } }
      { $_ -in @('temporarily_unavailable','temporary_unavailable','request_temporarily_rejected') } { return [pscustomobject]@{ ReasonClass = 'temporary_provider_rejection'; Recognized = $true } }
      default { if ([string]::IsNullOrWhiteSpace($value)) { return $fallback }; return [pscustomobject]@{ ReasonClass = 'provider_rejection_other'; Recognized = $false } }
    }
  } catch { return $fallback }
}

function Get-AuthHttpFailureDetails([int]$StatusCode, [pscustomobject]$ProviderReason = $null) {
  if ($null -eq $ProviderReason) { $ProviderReason = [pscustomobject]@{ ReasonClass = 'not_observed'; Recognized = $false } }
  $classification = if ($StatusCode -eq 400 -and [bool]$ProviderReason.Recognized) {
    switch ([string]$ProviderReason.ReasonClass) {
      'credential_rejection' { 'R6_AUTH_CREDENTIAL_REJECTED' }
      'email_confirmation_required' { 'R6_AUTH_EMAIL_CONFIRMATION_REQUIRED' }
      'account_disabled_or_banned' { 'R6_AUTH_ACCOUNT_DISABLED_OR_BANNED' }
      'project_or_public_key_rejection' { 'R6_AUTH_PROJECT_OR_PUBLIC_KEY_REJECTED' }
      'verification_required' { 'R6_AUTH_VERIFICATION_REQUIRED' }
      'rate_limited' { 'R6_AUTH_RATE_LIMITED' }
      'temporary_provider_rejection' { 'R6_AUTH_TEMPORARY_PROVIDER_REJECTION' }
      default { 'R6_AUTH_HTTP_BAD_REQUEST' }
    }
  } elseif ($StatusCode -eq 400) { 'R6_AUTH_HTTP_BAD_REQUEST' } elseif ($StatusCode -eq 401) { 'R6_AUTH_HTTP_UNAUTHORIZED' } elseif ($StatusCode -eq 403) { 'R6_AUTH_HTTP_FORBIDDEN' } elseif ($StatusCode -eq 404) { 'R6_AUTH_HTTP_NOT_FOUND' } elseif ($StatusCode -eq 429) { 'R6_AUTH_HTTP_RATE_LIMITED' } elseif ($StatusCode -ge 500 -and $StatusCode -le 599) { 'R6_AUTH_HTTP_SERVER_ERROR' } else { 'R6_AUTH_HTTP_OTHER_REJECTION' }
  return [pscustomobject]@{ Classification = $classification; NetworkFailureKind = 'none'; TlsFailureKind = 'none'; HttpStatusCode = $StatusCode; ProviderReasonClass = [string]$ProviderReason.ReasonClass; ProviderReasonRecognized = [bool]$ProviderReason.Recognized; ResponseReceived = $true }
}

function Get-AuthPasswordGrantFailureDetails([object]$ErrorRecord) {
  $exception = $ErrorRecord.Exception
  $details = if ($null -ne $ErrorRecord.ErrorDetails) { [string]$ErrorRecord.ErrorDetails.Message } else { '' }
  for ($depth = 0; $depth -lt 8 -and $null -ne $exception; $depth += 1) {
    $response = $exception.PSObject.Properties['Response']
    if ($null -ne $response -and $null -ne $response.Value) {
      $statusProperty = $response.Value.PSObject.Properties['StatusCode']
      if ($null -ne $statusProperty) {
        try { return Get-AuthHttpFailureDetails ([int]$statusProperty.Value) (Get-AuthProviderRejectionDetails $details) } catch { }
      }
    }
    if ($exception -is [System.Net.WebException]) {
      switch ($exception.Status) {
        ([System.Net.WebExceptionStatus]::NameResolutionFailure) { return [pscustomobject]@{ Classification='R6_AUTH_DNS_RESOLUTION_FAILED'; NetworkFailureKind='dns'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
        ([System.Net.WebExceptionStatus]::ConnectFailure) { return [pscustomobject]@{ Classification='R6_AUTH_CONNECTION_FAILED'; NetworkFailureKind='connection'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
        ([System.Net.WebExceptionStatus]::Timeout) { return [pscustomobject]@{ Classification='R6_AUTH_CONNECTION_TIMEOUT'; NetworkFailureKind='timeout'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
        ([System.Net.WebExceptionStatus]::TrustFailure) { return [pscustomobject]@{ Classification='R6_AUTH_TLS_NEGOTIATION_FAILED'; NetworkFailureKind='tls'; TlsFailureKind='trust'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
        ([System.Net.WebExceptionStatus]::SecureChannelFailure) { return [pscustomobject]@{ Classification='R6_AUTH_TLS_NEGOTIATION_FAILED'; NetworkFailureKind='tls'; TlsFailureKind='secure_channel'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
      }
    }
    $message = [string]$exception.Message
    if ($message -match '(?i)(trust relationship|certificate|secure channel|tls|ssl)') { return [pscustomobject]@{ Classification='R6_AUTH_TLS_NEGOTIATION_FAILED'; NetworkFailureKind='tls'; TlsFailureKind='other'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
    if ($message -match '(?i)(name resolution|name.*not.*resolved|no such host)') { return [pscustomobject]@{ Classification='R6_AUTH_DNS_RESOLUTION_FAILED'; NetworkFailureKind='dns'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
    if ($message -match '(?i)(timed out|timeout)') { return [pscustomobject]@{ Classification='R6_AUTH_CONNECTION_TIMEOUT'; NetworkFailureKind='timeout'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
    if ($message -match '(?i)(connect.*fail|connection.*refused)') { return [pscustomobject]@{ Classification='R6_AUTH_CONNECTION_FAILED'; NetworkFailureKind='connection'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false } }
    $exception = $exception.InnerException
  }
  return [pscustomobject]@{ Classification='R6_AUTH_UNEXPECTED_FAILURE'; NetworkFailureKind='unknown'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false }
}

function Set-AuthPasswordGrantFailureState([System.Collections.IDictionary]$State, [pscustomobject]$Details) {
  $State['responseReceived'] = [bool]$Details.ResponseReceived
  $State['networkFailureKind'] = [string]$Details.NetworkFailureKind
  $State['tlsFailureKind'] = [string]$Details.TlsFailureKind
  $State['httpStatusCode'] = $Details.HttpStatusCode
  $State['providerReasonClass'] = [string]$Details.ProviderReasonClass
  $State['providerReasonRecognized'] = [bool]$Details.ProviderReasonRecognized
  $State['failureStage'] = 'AUTH_PASSWORD_GRANT_REQUEST'
}

function Assert-AuthPasswordGrantEndpointBinding([pscustomobject]$Inputs, [System.Collections.IDictionary]$State) {
  try {
    $uri = [Uri]("https://$($Inputs.ProjectRef).supabase.co/auth/v1/token?grant_type=password")
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne ($Inputs.ProjectRef + '.supabase.co') -or $uri.Port -ne 443 -or -not [string]::IsNullOrWhiteSpace($uri.UserInfo) -or $uri.AbsolutePath -ne '/auth/v1/token' -or $uri.Query -ne '?grant_type=password') { throw 'invalid' }
    $State['endpointBindingPassed'] = $true; $State['projectConfigurationPassed'] = $true
    return $uri.AbsoluteUri
  } catch {
    $State['failureStage'] = 'AUTH_PASSWORD_GRANT_ENDPOINT_BINDING'
    throw 'R6_AUTH_ENDPOINT_BINDING_INVALID'
  }
}

function Invoke-AuthPasswordGrantFixture([System.Collections.IDictionary]$State, [string]$FixtureKind) {
  $State['credentialPromptReached'] = $true; $State['authenticationStageReached'] = $true; $State['endpointBindingPassed'] = $true; $State['projectConfigurationPassed'] = $true
  $kind = if ([string]::IsNullOrWhiteSpace($FixtureKind)) { 'success' } else { $FixtureKind }
  if ($kind -eq 'success') {
    $State['requestAttempted'] = $true; $State['requestDispatched'] = $true; $State['responseReceived'] = $true; $State['authenticationAttempted'] = $true; $State['authenticationCompleted'] = $true; $State['sessionCreated'] = $true; $State['sessionValidated'] = $true; $State['authenticatedCheckReached'] = $true; $State['authenticatedCheckCompleted'] = $true; $State['childStarted'] = $true; $State['childExitCode'] = 0
    return
  }
  if ($kind -eq 'endpoint') { $State['endpointBindingPassed'] = $false; $State['projectConfigurationPassed'] = $false; $State['failureStage'] = 'AUTH_PASSWORD_GRANT_ENDPOINT_BINDING'; throw 'R6_AUTH_ENDPOINT_BINDING_INVALID' }
  if ($kind -eq 'project') { $State['projectConfigurationPassed'] = $false; $State['failureStage'] = 'AUTH_PASSWORD_GRANT_PROJECT_CONFIGURATION'; throw 'R6_AUTH_PROJECT_CONFIGURATION_INVALID' }
  $State['requestAttempted'] = $true; $State['requestDispatched'] = $true; $State['authenticationAttempted'] = $true
  if ($kind -match '^http(400|401|403|404|429|500|502|503|418)(?:-(credential|email-confirmation|account-disabled|project-key|verification|rate-limited|temporary|malformed-json|empty))?$') {
    $status = [int]$Matches[1]; $providerFixture = if ($kind -eq 'http401') { '{"error":"invalid_credentials"}' } elseif ($kind -eq 'http429') { '{"error":"rate_limit"}' } elseif ($kind -eq 'http400') { '{"error":"unknown_provider_code"}' } elseif ($kind -eq 'http418') { '{"code":"unknown_provider_code"}' } elseif ($kind -eq 'http400-credential') { '{"error_code":"invalid_credentials"}' } elseif ($kind -eq 'http400-email-confirmation') { '{"code":"email_not_confirmed"}' } elseif ($kind -eq 'http400-account-disabled') { '{"error":"account_disabled"}' } elseif ($kind -eq 'http400-project-key') { '{"error_code":"invalid_api_key"}' } elseif ($kind -eq 'http400-verification') { '{"code":"captcha_required"}' } elseif ($kind -eq 'http400-rate-limited') { '{"code":"rate_limited"}' } elseif ($kind -eq 'http400-temporary') { '{"status":"temporarily_unavailable"}' } elseif ($kind -eq 'http400-malformed-json') { '{' } else { '' }; $provider = Get-AuthProviderRejectionDetails $providerFixture
    $details = Get-AuthHttpFailureDetails $status $provider; Set-AuthPasswordGrantFailureState $State $details; throw $details.Classification
  }
  if ($kind -eq 'malformed') { $State['responseReceived'] = $true; $State['failureStage'] = 'AUTH_PASSWORD_GRANT_RESPONSE'; throw 'R6_AUTH_RESPONSE_MALFORMED' }
  if ($kind -eq 'unexpected') { $details = [pscustomobject]@{ Classification='R6_AUTH_UNEXPECTED_FAILURE'; NetworkFailureKind='unknown'; TlsFailureKind='none'; HttpStatusCode=$null; ProviderReasonClass='not_observed'; ProviderReasonRecognized=$false; ResponseReceived=$false }; Set-AuthPasswordGrantFailureState $State $details; throw $details.Classification }
  $webStatus = switch ($kind) { 'dns' { [System.Net.WebExceptionStatus]::NameResolutionFailure }; 'connection' { [System.Net.WebExceptionStatus]::ConnectFailure }; 'timeout' { [System.Net.WebExceptionStatus]::Timeout }; 'tls-trust' { [System.Net.WebExceptionStatus]::TrustFailure }; 'tls-channel' { [System.Net.WebExceptionStatus]::SecureChannelFailure }; default { throw 'R6_AUTH_TEST_FIXTURE_INVALID' } }
  try { throw [System.Net.WebException]::new('fixture', $webStatus) } catch { $details = Get-AuthPasswordGrantFailureDetails $_; Set-AuthPasswordGrantFailureState $State $details; throw $details.Classification }
}

function Invoke-PasswordGrant([pscustomobject]$Inputs, [System.Collections.IDictionary]$State = $null) {
  $anon = $null; $password = $null
  try {
    if ($null -eq $State) { $State = [ordered]@{} }
    $anon = Convert-SecureStringToPlaintext $Inputs.AnonSecure
    $password = Convert-SecureStringToPlaintext $Inputs.PasswordSecure
    if ([string]::IsNullOrWhiteSpace($anon) -or (Test-ServiceRoleLookingKey $anon)) { $State['projectConfigurationPassed'] = $false; $State['failureStage'] = 'AUTH_PASSWORD_GRANT_PROJECT_CONFIGURATION'; throw 'R6_AUTH_PROJECT_CONFIGURATION_INVALID' }
    $endpoint = Assert-AuthPasswordGrantEndpointBinding $Inputs $State
    $body = @{ email = $Inputs.Email; password = $password } | ConvertTo-Json -Compress
    $headers = @{ apikey = $anon; 'Content-Type' = 'application/json' }
    $State['requestAttempted'] = $true; $State['requestDispatched'] = $true; $State['authenticationAttempted'] = $true
    try { $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $body -TimeoutSec 20 -ErrorAction Stop }
    catch { $details = Get-AuthPasswordGrantFailureDetails $_; Set-AuthPasswordGrantFailureState $State $details; throw $details.Classification }
    $State['responseReceived'] = $true
    $accessToken = [string]$response.access_token
    $userId = [string]$response.user.id
    $confirmed = -not [string]::IsNullOrWhiteSpace([string]$response.user.email_confirmed_at)
    if ([string]::IsNullOrWhiteSpace($accessToken) -or $userId -notmatch '^[0-9a-f]{8}-[0-9a-f-]{27,}$' -or -not $confirmed) { $State['failureStage'] = 'AUTH_PASSWORD_GRANT_RESPONSE'; throw 'R6_AUTH_RESPONSE_MALFORMED' }
    return [pscustomobject]@{ AccessToken = $accessToken; UserId = $userId; AnonKey = $anon; ProjectRef = $Inputs.ProjectRef }
  } finally {
    $anon = $null; $password = $null
    if ($null -ne $Inputs.AnonSecure) { $Inputs.AnonSecure.Dispose() }
    if ($null -ne $Inputs.PasswordSecure) { $Inputs.PasswordSecure.Dispose() }
  }
}

function Clear-RunnerEnvironment {
  foreach ($name in $script:RunnerEnvironmentNames) { Remove-Item -LiteralPath ("Env:$name") -ErrorAction SilentlyContinue }
}

function Assert-NoPreexistingSecrets {
  foreach ($name in $script:SecretEnvironmentNames) {
    if (-not [string]::IsNullOrWhiteSpace([string][Environment]::GetEnvironmentVariable($name, 'Process'))) { throw "R6_PREEXISTING_SECRET_ENV_DENIED:$name" }
  }
}

function Clear-TargetResolverEnvironment {
  foreach ($name in @('QA_SUPABASE_URL','QA_BASE_URL','QA_CANARY_ACCESS_TOKEN','QA_CANARY_SUPABASE_ANON_KEY','QA_EXPECTED_RUNNER_COMMIT','QA_EXPECTED_TOOLING_COMMIT','QA_CANARY_REQUEST_TIMEOUT_MS')) {
    Remove-Item -LiteralPath ("Env:$name") -ErrorAction SilentlyContinue
  }
}

function Resolve-DryRunCanonicalTarget([pscustomobject]$Auth, [string]$RequestedCircleSlug, [string]$Root, [string]$ValidatedExecutionCommit, [System.Collections.IDictionary]$State) {
  $targetPath = Join-Path $Root 'canonical-canary-target-binding.json'
  $State['failureStage'] = 'TARGET_RESOLUTION'
  $State['targetResolutionStarted'] = $true
  if ([string]::IsNullOrWhiteSpace($RequestedCircleSlug)) {
    Set-TargetResolutionFailureState $State 'QA_CANARY_TARGET_REQUESTED_SLUG_INVALID' $targetPath
    throw 'QA_CANARY_TARGET_REQUESTED_SLUG_INVALID'
  }
  if (Test-Path -LiteralPath $targetPath) {
    Set-TargetResolutionFailureState $State 'QA_CANARY_TARGET_BINDING_OUTPUT_EXISTS' $targetPath
    throw 'QA_CANARY_TARGET_BINDING_OUTPUT_EXISTS'
  }
  Assert-NoPreexistingSecrets
  try {
    [Environment]::SetEnvironmentVariable('QA_SUPABASE_URL', "https://$($Auth.ProjectRef).supabase.co", 'Process')
    [Environment]::SetEnvironmentVariable('QA_BASE_URL', $script:ExpectedBaseUrl, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_ACCESS_TOKEN', $Auth.AccessToken, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_SUPABASE_ANON_KEY', $Auth.AnonKey, 'Process')
    [Environment]::SetEnvironmentVariable('QA_EXPECTED_RUNNER_COMMIT', $ValidatedExecutionCommit, 'Process')
    [Environment]::SetEnvironmentVariable('QA_EXPECTED_TOOLING_COMMIT', $ValidatedExecutionCommit, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_REQUEST_TIMEOUT_MS', '30000', 'Process')
    $resolver = Join-Path $ExecutionWorktree 'scripts\qa\resolve-canonical-canary-target.mjs'
    if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1' -and -not [string]::IsNullOrWhiteSpace([string]$env:R6_V3_ORCHESTRATION_TEST_TARGET_RESOLVER_ENTRYPOINT)) {
      $candidate = [string]$env:R6_V3_ORCHESTRATION_TEST_TARGET_RESOLVER_ENTRYPOINT
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_TARGET_RESOLVER_INVALID' }
      $resolver = $candidate
    }
    $previous = $ErrorActionPreference
    try { $ErrorActionPreference = 'Continue'; $lines = @(& node $resolver '--requested-slug' $RequestedCircleSlug '--output' $targetPath 2>&1); $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
    if ($exitCode -ne 0) {
      $code = Get-TargetResolutionFailureCode $lines $exitCode
      Set-TargetResolutionFailureState $State $code $targetPath
      throw $code
    }
    if ($lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne 'QA_CANARY_TARGET_BINDING_READY') {
      Set-TargetResolutionFailureState $State 'QA_CANARY_TARGET_RESOLUTION_OUTPUT_INVALID' $targetPath
      throw 'QA_CANARY_TARGET_RESOLUTION_OUTPUT_INVALID'
    }
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
      Set-TargetResolutionFailureState $State 'QA_CANARY_TARGET_BINDING_MISSING' $targetPath
      throw 'QA_CANARY_TARGET_BINDING_MISSING'
    }
    $State['targetBindingArtifactPresent'] = $true
    try { Invoke-CanonicalCanaryTargetBindingValidator $targetPath } catch {
      Set-TargetResolutionFailureState $State 'QA_CANARY_TARGET_BINDING_INVALID' $targetPath
      $State['targetBindingArtifactPresent'] = $true
      $State['targetBindingCreated'] = $true
      throw 'QA_CANARY_TARGET_BINDING_INVALID'
    }
    Set-TargetResolutionSuccessState $State
    return $targetPath
  } finally {
    Clear-TargetResolverEnvironment
  }
}

function Set-RunnerEnvironment([pscustomobject]$Auth, [string]$Mode, [string]$RequestedRunId, [pscustomobject]$Reservation, [string]$ChildTerminalPath, [string]$ValidatedExecutionCommit, [string]$TargetBindingPath) {
  Assert-NoPreexistingSecrets
  [Environment]::SetEnvironmentVariable('QA_SUPABASE_URL', "https://$($Auth.ProjectRef).supabase.co", 'Process')
  [Environment]::SetEnvironmentVariable('QA_EXPECTED_SUPABASE_REF', $Auth.ProjectRef, 'Process')
  [Environment]::SetEnvironmentVariable('QA_PRODUCTION_SUPABASE_REF', $Auth.ProjectRef, 'Process')
  [Environment]::SetEnvironmentVariable('QA_BASE_URL', $script:ExpectedBaseUrl, 'Process')
  $expectedRunnerCommit = if ($null -ne $Reservation) { [string]$Reservation.RunnerCommit } else { $script:ExpectedRunnerCommit }
  if ($expectedRunnerCommit -notmatch '^[a-f0-9]{40}$' -or $ValidatedExecutionCommit -notmatch '^[a-f0-9]{40}$' -or $expectedRunnerCommit -ne $ValidatedExecutionCommit) { throw 'QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH' }
  if ($null -ne $Reservation -and [string]$Reservation.RunnerCommit -ne $ValidatedExecutionCommit) { throw 'QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH' }
  if (-not [string]::IsNullOrWhiteSpace($ChildTerminalPath) -and (-not (Test-WindowsFullyQualifiedPath $ChildTerminalPath) -or (Split-Path -Leaf $ChildTerminalPath) -ne 'minimal-canary-child-terminal-result.json' -or (Test-Path -LiteralPath $ChildTerminalPath))) { throw 'QA_CANARY_CHILD_TERMINAL_PATH_INVALID' }
  [Environment]::SetEnvironmentVariable('QA_EXPECTED_RUNNER_COMMIT', $expectedRunnerCommit, 'Process')
  [Environment]::SetEnvironmentVariable('QA_EXPECTED_TOOLING_COMMIT', $ValidatedExecutionCommit, 'Process')
  [Environment]::SetEnvironmentVariable('QA_EXPECTED_DEPLOYED_COMMIT', $script:ExpectedDeployedCommit, 'Process')
  [Environment]::SetEnvironmentVariable('QA_DEPLOYMENT_ATTESTATION_PATH', $Auth.AttestationPath, 'Process')
  [Environment]::SetEnvironmentVariable('QA_DEPLOYMENT_ATTESTATION_SHA256', $Auth.AttestationSha256, 'Process')
  [Environment]::SetEnvironmentVariable('QA_CANARY_ACCESS_TOKEN', $Auth.AccessToken, 'Process')
  [Environment]::SetEnvironmentVariable('QA_CANARY_SUPABASE_ANON_KEY', $Auth.AnonKey, 'Process')
  if ([string]::IsNullOrWhiteSpace($TargetBindingPath) -or -not (Test-Path -LiteralPath $TargetBindingPath -PathType Leaf)) { throw 'QA_CANARY_TARGET_BINDING_REQUIRED' }
  [Environment]::SetEnvironmentVariable('QA_CANARY_TARGET_BINDING_PATH', $TargetBindingPath, 'Process')
  [Environment]::SetEnvironmentVariable('QA_CANARY_JOURNAL_ROOT', (Get-ExpectedJournalRoot), 'Process')
  if ($null -ne $Reservation) {
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_REGISTRY_ROOT', $Reservation.RegistryRoot, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_RECEIPT_PATH', $Reservation.ReceiptPath, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_RECEIPT_SHA256', $Reservation.ReceiptSha256, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_NONCE', $Reservation.InvocationNonce, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_WRAPPER_VERSION', $script:ConsumedRunWrapperVersion, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_WRAPPER_SHA256', $Reservation.WrapperSha256, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CHILD_COMMAND_SHA256', $Reservation.ChildCommandDigest, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($ChildTerminalPath)) { [Environment]::SetEnvironmentVariable('QA_CANARY_CHILD_TERMINAL_PATH', $ChildTerminalPath, 'Process') }
  }
  if ($Mode -eq 'ExecuteApprovedPhase') {
    [Environment]::SetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', '1', 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_APPROVAL', $script:RunnerApproval, 'Process')
  }
}

function Invoke-CommittedRunner([string]$Worktree, [string[]]$Arguments) {
  Push-Location -LiteralPath $Worktree
  try {
    $lines = @(& node $script:RunnerRelativePath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      $codes = @($lines | ForEach-Object { [string]$_ } | ForEach-Object { [regex]::Matches($_, 'QA_CANARY_[A-Z0-9_]+') } | ForEach-Object { $_.Value } | Where-Object { $_ -ne 'QA_CANARY_FAILED' } | Select-Object -Unique)
      if ($codes.Count -eq 1) { throw $codes[0] }
      throw 'R6_COMMITTED_RUNNER_FAILED'
    }
    $lines | ForEach-Object { Write-Output $_ }
  } finally { Pop-Location }
}

function Import-R6NativeChildProcessHelper([string]$Worktree) {
  $helper = Join-Path $Worktree 'scripts\qa\r6-native-child-process.psm1'
  if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'QA_CANARY_CHILD_HELPER_MISSING' }
  Import-Module -Name $helper -Force -Global -ErrorAction Stop
}

function Invoke-DryRunRunner([string]$Worktree, [string]$RequestedRunId, [string]$ChildTerminalPath) {
  if ($RequestedRunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'R6_DRY_RUN_ID_INVALID' }
  # The target guard reads --confirm-run before the runner selects its dry-run return branch.
  # A dry-run's unique run ID is therefore its fresh runner-level confirmation identity.
  $arguments = @('--dry-run', '--run-id', $RequestedRunId, '--confirm-run', $RequestedRunId)
  if (-not [string]::IsNullOrWhiteSpace($ChildTerminalPath)) { $arguments += @('--child-terminal-path', $ChildTerminalPath) }
  if ($arguments -notcontains '--dry-run' -or $arguments -contains '--execute' -or $arguments -contains '--recover-run') { throw 'R6_DRY_RUN_ARGUMENTS_UNSAFE' }
  if (-not [string]::IsNullOrWhiteSpace([string][Environment]::GetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', 'Process'))) { throw 'R6_DRY_RUN_FLAG_PREEXISTING' }
  try {
    # This is only the b9 target-guard acknowledgement. The exact runner returns before adapter creation.
    [Environment]::SetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', '1', 'Process')
    if ([string][Environment]::GetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', 'Process') -ne '1') { throw 'R6_DRY_RUN_FLAG_SET_FAILED' }
    Import-R6NativeChildProcessHelper $Worktree
    $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $entrypoint = $script:RunnerRelativePath
    if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -eq '1' -and -not [string]::IsNullOrWhiteSpace([string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_CHILD_ENTRYPOINT)) {
      $candidate = [string]$env:R6_V3_ORCHESTRATION_TEST_DRY_RUN_CHILD_ENTRYPOINT
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_TEST_CHILD_ENTRYPOINT_INVALID' }
      $entrypoint = $candidate
    }
    return Invoke-R6NativeChildProcess -FileName $node -Arguments (@($entrypoint) + $arguments) -WorkingDirectory $Worktree -TimeoutMilliseconds $script:ChildProcessTimeoutMilliseconds
  } finally {
    Remove-Item -LiteralPath 'Env:QA_ALLOW_PRODUCTION_WRITES' -ErrorAction SilentlyContinue
  }
}

function Invoke-ValidatedDryRunChild([string]$Worktree, [string]$RequestedRunId, [string]$ChildTerminalPath, [string]$ValidatedExecutionCommit, [System.Collections.IDictionary]$State) {
  $child = Invoke-DryRunRunner $Worktree $RequestedRunId $ChildTerminalPath
  $State['childCompleted'] = [bool]$child.ChildCompleted; $State['childTimedOut'] = [bool]$child.ChildTimedOut; $State['childExitCode'] = [int]$child.ChildExitCode; $State['stdoutClassification'] = $child.StdoutClassification; $State['stderrClassification'] = $child.StderrClassification
  if ($State['childTimedOut']) { throw 'QA_CANARY_CHILD_TIMEOUT' }
  if (-not (Test-Path -LiteralPath $ChildTerminalPath -PathType Leaf)) {
    if ([int]$child.ChildExitCode -ne 0) {
      $fallback = if (-not [string]::IsNullOrWhiteSpace([string]$child.StderrClassification)) { [string]$child.StderrClassification } elseif (-not [string]::IsNullOrWhiteSpace([string]$child.StdoutClassification)) { [string]$child.StdoutClassification } else { 'QA_CANARY_CHILD_UNEXPECTED_FAILURE' }
      throw $fallback
    }
    throw 'QA_CANARY_CHILD_TERMINAL_MISSING'
  }
  $State['childTerminalPath'] = $ChildTerminalPath; $State['childTerminalSha256'] = Get-Sha256 $ChildTerminalPath; $State['childTerminalLocated'] = $true
  Invoke-FinalNodeValidator $Worktree 'scripts/qa/validate-production-minimal-canary-child-terminal.mjs' $ChildTerminalPath 'QA_MINIMAL_CANARY_CHILD_TERMINAL_OK' 'QA_CANARY_CHILD_TERMINAL_INVALID'
  $childTerminal = Read-AttestationJson $ChildTerminalPath
  if ($childTerminal.runId -ne $RequestedRunId -or $childTerminal.mode -ne 'dry-run' -or $childTerminal.runnerCommit -ne $ValidatedExecutionCommit -or $childTerminal.expectedToolingCommit -ne $ValidatedExecutionCommit -or [int]$childTerminal.childExitCode -ne [int]$child.ChildExitCode) { throw 'QA_CANARY_CHILD_TERMINAL_INVALID' }
  $State['childTerminalValidated'] = $true
  if (-not [bool]$childTerminal.success) { $State['failureStage'] = [string]$childTerminal.failureStage; throw ([string]$childTerminal.classification) }
  if ([int]$child.ChildExitCode -ne 0 -or $childTerminal.failureStage -ne 'complete') { throw 'QA_CANARY_CHILD_TERMINAL_INVALID' }
  return $childTerminal
}

function Write-FinalCanaryEvidence([string]$Root, [string]$Name, [System.Collections.IDictionary]$Data) {
  if (-not (Test-WindowsFullyQualifiedPath $Root) -or [string]::IsNullOrWhiteSpace($Name) -or $Name -match '[\\/]') { throw 'R6_FINAL_EVIDENCE_PATH_INVALID' }
  foreach ($key in $Data.Keys) { if ([string]$key -match '(?i)(password|access[_-]?token|refresh[_-]?token|authorization|anon[_-]?key|account[_-]?id)') { throw 'R6_EVIDENCE_SECRET_PATTERN_REJECTED' } }
  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  $file = Join-Path $Root $Name
  if (Test-Path -LiteralPath $file) { throw 'R6_FINAL_EVIDENCE_EXISTS' }
  $temporary = $file + '.' + [guid]::NewGuid().ToString() + '.tmp'
  $json = $Data | ConvertTo-Json -Depth 8
  try {
    [IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary, $file)
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue } }
  return $file
}

function Invoke-LiveRunner([string]$Worktree, [string]$RequestedRunId, [string]$ChildTerminalPath) {
  if ($RequestedRunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'R6_RUN_ID_INVALID' }
  if (-not (Test-WindowsFullyQualifiedPath $ChildTerminalPath) -or (Split-Path -Leaf $ChildTerminalPath) -ne 'minimal-canary-child-terminal-result.json' -or (Test-Path -LiteralPath $ChildTerminalPath)) { throw 'QA_CANARY_CHILD_TERMINAL_PATH_INVALID' }
  Import-R6NativeChildProcessHelper $Worktree
  $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
  return Invoke-R6NativeChildProcess -FileName $node -Arguments @($script:RunnerRelativePath, '--execute', '--run-id', $RequestedRunId, '--confirm-run', $RequestedRunId, '--child-terminal-path', $ChildTerminalPath) -WorkingDirectory $Worktree -TimeoutMilliseconds $script:ChildProcessTimeoutMilliseconds
}

function Get-ExecutionJournalEvidence([string]$JournalRoot, [string]$RequestedRunId) {
  $path = Join-Path (Join-Path $JournalRoot $RequestedRunId) 'journal.json'
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return [pscustomobject]@{ Exists=$false; Path=$null; Sha256=$null; ActualMutationCount=0; AdapterReached=$false; Complete=$false } }
  $journal = Read-AttestationJson $path
  $count = 0
  if ($null -ne (Get-OptionalJsonProperty $journal.artifacts 'post')) { $count += 1 }
  if ($null -ne (Get-OptionalJsonProperty $journal.artifacts 'comment')) { $count += 1 }
  return [pscustomobject]@{ Exists=$true; Path=$path; Sha256=(Get-Sha256 $path); ActualMutationCount=$count; AdapterReached=$true; Complete=([string]$journal.state -eq 'COMPLETE') }
}

function Invoke-FinalNodeValidator([string]$Worktree, [string]$RelativeValidator, [string]$Path, [string]$SuccessMarker, [string]$FailureCode) {
  Push-Location -LiteralPath $Worktree
  try { $lines = @(& node $RelativeValidator $Path 2>&1); $exitCode = $LASTEXITCODE } finally { Pop-Location }
  if ($exitCode -ne 0 -or $lines.Count -ne 1 -or $lines[0].ToString().Trim() -ne $SuccessMarker) { throw $FailureCode }
}

function Invoke-PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight([pscustomobject]$Validation, [pscustomobject]$Binding) {
  $root = Assert-CurrentCanonicalProductionV3EvidenceRoot $EvidenceRoot
  $captureTerminalPath = Join-Path $root 'capture-auth-check-orchestration-terminal-result.json'
  $finalModeTerminalPath = Join-Path $root 'final-capture-auth-execute-postflight-binding-terminal-result.json'
  $state = [ordered]@{
    schemaVersion = 'r6-final-capture-auth-execute-postflight-binding-terminal-result-v1'; startedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); completedAt = $null
    outerClassification = $null; innerClassification = $null; success = $false; failureStage = 'FRESH_CAPTURE'
    executionWorktree = $Validation.Path; executionCommit = $Validation.Head; runnerCommit = $Binding.runnerCommit; toolingCommit = $Binding.toolingCommit
    bindingPath = $FinalExecutionBindingPath; bindingFileHash = $FinalExecutionBindingSha256; bindingValidated = $true
    parentDryRunRunId = $Binding.parentDryRunRunId; parentBindingFileHash = $Binding.parentAuthorizationSha256; parentReceiptState = 'CONSUMED'; parentDryRunValidated = $true
    captureCompleted = $false; captureSuccess = $false; authCheckCompleted = $false; authCheckSuccess = $false; freshAttestationPath = $null; freshAttestationSha256 = $null
    executeCompleted = $false; postflightCompleted = $false; productionMutationCount = 0; retryCount = 0
  }
  try {
    # The capture/auth helper owns initial evidence-root creation. Creating it
    # here would make that helper fail before its first local/network boundary.
    $null = Invoke-PrepareCurrentCanonicalProductionV3AndAuthCheckOnly $Validation
    $state.captureCompleted = $true; $state.captureSuccess = $true; $state.authCheckCompleted = $true; $state.authCheckSuccess = $true
    $capture = Read-AttestationJson $captureTerminalPath
    if (-not [bool]$capture.success -or [string]$capture.outerClassification -ne 'R6_CURRENT_CANONICAL_V3_CAPTURE_AND_AUTH_CHECK_ONLY_READY') { throw 'R6_FINAL_FRESH_CAPTURE_OR_AUTH_CHECK_INVALID' }
    $state.freshAttestationPath = [string]$capture.attestationPath; $state.freshAttestationSha256 = [string]$capture.attestationSha256
    $state.failureStage = 'FRESH_ATTESTATION'
    $attestation = Assert-DeploymentAttestation $state.freshAttestationPath $state.freshAttestationSha256
    Assert-MinimumAttestationValidity $attestation | Out-Null
    $script:FinalExecutionBinding = $Binding
    $script:DeploymentAttestationPath = $state.freshAttestationPath
    $script:DeploymentAttestationSha256 = $state.freshAttestationSha256
    $script:FinalAuthorizationBindingPath = [string]$Binding.parentAuthorizationPath
    $script:FinalAuthorizationBindingSha256 = [string]$Binding.parentAuthorizationSha256
    $script:PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight = $false
    $script:ExecuteApprovedPhase = $true
    $state.failureStage = 'LIVE_RECEIPT_CREATION'
    Invoke-Main
    $state.executeCompleted = $true; $state.postflightCompleted = $true; $state.productionMutationCount = 2
    $state.failureStage = $null; $state.outerClassification = 'R6_FINAL_CAPTURE_AUTH_EXECUTE_AND_POSTFLIGHT_COMPLETE'; $state.success = $true
  } catch {
    $state.innerClassification = Get-ValueBlindFailureCode $_ 'R6_FINAL_ORCHESTRATION_UNEXPECTED_FAILURE'
    if ($state.failureStage -eq 'FRESH_CAPTURE' -and $state.captureCompleted) { $state.failureStage = 'FRESH_AUTH_CHECK' }
    $state.outerClassification = 'R6_FINAL_CAPTURE_AUTH_EXECUTE_AND_POSTFLIGHT_FAILED'
  } finally {
    $state.completedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    if (Test-Path -LiteralPath $root) { $null = Write-FinalCanaryEvidence $root (Split-Path -Leaf $finalModeTerminalPath) $state }
    $script:FinalExecutionBinding = $null
  }
  if (-not $state.success) { throw $state.outerClassification }
  Write-Output $state.outerClassification
}

function Invoke-Main {
  Set-R6WrapperStage 'MODE_RESOLUTION'
  $mode = Get-Mode
  Set-R6WrapperStage 'GIT_EXECUTABLE_RESOLUTION'
  Resolve-R6GitExecutable
  if ($mode -eq 'PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight') {
    Assert-CurrentCanonicalProductionV3Bindings
    if (-not [string]::IsNullOrWhiteSpace($DeploymentAttestationPath) -or -not [string]::IsNullOrWhiteSpace($DeploymentAttestationSha256) -or -not [string]::IsNullOrWhiteSpace($FinalAuthorizationBindingPath) -or -not [string]::IsNullOrWhiteSpace($FinalAuthorizationBindingSha256) -or -not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { throw 'R6_FINAL_MODE_INPUTS_UNSAFE' }
    Assert-PhaseApproval $PhaseApproval
    if ([string]::IsNullOrWhiteSpace($FinalExecutionBindingPath) -or [string]::IsNullOrWhiteSpace($FinalExecutionBindingSha256)) { throw 'R6_FINAL_LOCAL_BINDING_REQUIRED' }
    $binding = Get-FinalExecutionBinding $FinalExecutionBindingPath $FinalExecutionBindingSha256 $ExecutionWorktree
    $validation = Assert-FinalExecutionWorktree $ExecutionWorktree $binding $RunId
    $null = Assert-FinalParentDryRunAuthorization $binding $RunId
    Assert-RunIdEligible $validation.Path $RunId | Out-Null
    Assert-RunIdJournalAbsent $RunId
    Invoke-PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight $validation $binding
    return
  }
  if ($mode -eq 'PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly') {
    Set-R6WrapperStage 'FIXED_BINDING_VALIDATION'
    Assert-CurrentCanonicalProductionV3Bindings
    if (-not [string]::IsNullOrWhiteSpace($DeploymentAttestationPath) -or -not [string]::IsNullOrWhiteSpace($DeploymentAttestationSha256) -or -not [string]::IsNullOrWhiteSpace($PhaseApproval) -or -not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_MODE_UNSAFE' }
    Set-R6WrapperStage 'DETACHED_WORKTREE_VALIDATION'
    $v3Validation = Assert-CurrentCanonicalProductionV3ExecutionWorktree $ExecutionWorktree
    if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -ne '1' -and -not [string]::IsNullOrWhiteSpace($V3OrchestrationFixtureKind)) { throw 'R6_CURRENT_CANONICAL_V3_DRY_RUN_ORCHESTRATION_TEST_FIXTURE_INVALID' }
    Invoke-PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly $v3Validation
    return
  }
  if ($mode -eq 'PrepareCurrentCanonicalProductionV3AndAuthCheckOnly') {
    Assert-CurrentCanonicalProductionV3Bindings
    if (-not [string]::IsNullOrWhiteSpace($DeploymentAttestationPath) -or -not [string]::IsNullOrWhiteSpace($DeploymentAttestationSha256) -or -not [string]::IsNullOrWhiteSpace($RunId) -or -not [string]::IsNullOrWhiteSpace($PhaseApproval) -or -not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_MODE_UNSAFE' }
    $v3Validation = Assert-CurrentCanonicalProductionV3ExecutionWorktree $ExecutionWorktree
    if ($env:R6_V3_ORCHESTRATION_WRAPPER_TEST_MODE -ne '1' -and -not [string]::IsNullOrWhiteSpace($V3OrchestrationFixtureKind)) { throw 'R6_CURRENT_CANONICAL_V3_ORCHESTRATION_TEST_FIXTURE_INVALID' }
    Invoke-PrepareCurrentCanonicalProductionV3AndAuthCheckOnly $v3Validation
    return
  }
  if ($mode -eq 'PrepareCurrentCanonicalProductionV3AuthDryRunAttestation') {
    Assert-CurrentCanonicalProductionV3Bindings
    if (-not [string]::IsNullOrWhiteSpace($DeploymentAttestationPath) -or -not [string]::IsNullOrWhiteSpace($DeploymentAttestationSha256) -or -not [string]::IsNullOrWhiteSpace($RunId) -or -not [string]::IsNullOrWhiteSpace($PhaseApproval)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_MODE_UNSAFE' }
    $v3Validation = Assert-CurrentCanonicalProductionV3ExecutionWorktree $ExecutionWorktree
    if (-not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { Invoke-CurrentCanonicalProductionV3FixtureTest $v3Validation; return }
    if ($env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE -eq '1') { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_FIXTURE_INVALID' }
    Invoke-PrepareCurrentCanonicalProductionV3AuthDryRunAttestation $v3Validation
    return
  }
  if (-not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE_REQUIRED' }
  if ($script:ExpectedBaseUrl -ne 'https://openglasshub.pages.dev') { throw 'R6_BASE_URL_INVALID' }
  if ($mode -eq 'AuthCheckOnly' -and (Test-CurrentCanonicalProductionV3DownstreamRoot $mode $EvidenceRoot)) {
    Invoke-CurrentCanonicalProductionV3AuthCheckOnly
    return
  }
  if ($mode -eq 'DryRunOnly' -and (Test-CurrentCanonicalProductionV3DownstreamRoot $mode $EvidenceRoot)) {
    Assert-CurrentCanonicalProductionV3Bindings
    $v3Validation = Assert-CurrentCanonicalProductionV3ExecutionWorktree $ExecutionWorktree
    $v3Downstream = Get-CurrentCanonicalProductionV3DownstreamParent $mode $EvidenceRoot
    $capture = Read-AttestationJson $v3Downstream.CaptureTerminal
    if ($capture.outerClassification -ne 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY' -or $capture.attestationPath -ne $DeploymentAttestationPath -or $capture.attestationSha256 -ne $DeploymentAttestationSha256 -or [string]$capture.commands[1] -notmatch [regex]::Escape('-DryRunOnly') -or [string]$capture.commands[1] -notmatch [regex]::Escape($v3Downstream.Root)) { throw 'R6_CURRENT_CANONICAL_V3_DOWNSTREAM_PROVENANCE_REJECTED' }
    # The existing dry-run approval, run-ID, and mutation guards remain unchanged.
    $validation = $v3Validation
  } elseif ($mode -eq 'ExecuteApprovedPhase' -and $null -ne $script:FinalExecutionBinding) {
    $validation = Assert-FinalExecutionWorktree $ExecutionWorktree $script:FinalExecutionBinding $RunId
  } else {
    $validation = Assert-ExecutionWorktree $ExecutionWorktree $RunId
  }
  if ($mode -eq 'PrepareAuthDryRunAttestation') {
    if (-not [string]::IsNullOrWhiteSpace($DeploymentAttestationPath) -or -not [string]::IsNullOrWhiteSpace($DeploymentAttestationSha256) -or -not [string]::IsNullOrWhiteSpace($RunId)) { throw 'R6_METADATA_PREPARATION_INPUTS_INVALID' }
    Invoke-PrepareAuthDryRunAttestation $validation.Path
    return
  }
  if ($mode -eq 'PreparePagesProjectAuthDryRunAttestation') {
    if (-not [string]::IsNullOrWhiteSpace($DeploymentAttestationPath) -or -not [string]::IsNullOrWhiteSpace($DeploymentAttestationSha256) -or -not [string]::IsNullOrWhiteSpace($RunId) -or -not [string]::IsNullOrWhiteSpace($PhaseApproval)) { throw 'R6_PAGES_PROJECT_WRAPPER_MODE_UNSAFE' }
    Invoke-PreparePagesProjectAuthDryRunAttestation $validation.Path
    return
  }
  if ($mode -eq 'PreparePagesProjectR2AuthDryRunAttestation') {
    if (-not [string]::IsNullOrWhiteSpace($DeploymentAttestationPath) -or -not [string]::IsNullOrWhiteSpace($DeploymentAttestationSha256) -or -not [string]::IsNullOrWhiteSpace($RunId) -or -not [string]::IsNullOrWhiteSpace($PhaseApproval)) { throw 'R6_PAGES_PROJECT_R2_WRAPPER_MODE_UNSAFE' }
    Invoke-PreparePagesProjectR2AuthDryRunAttestation $validation.Path
    return
  }
  $confirmationHash = $null
  $confirmationDomain = $null
  $reservation = $null
  if ($mode -eq 'DryRunOnly') {
    if ([string]::IsNullOrWhiteSpace($RunId)) { throw 'R6_DRY_RUN_ID_REQUIRED' }
    $confirmationDomain = 'dry-run'
    Assert-RunIdEligible $validation.Path $RunId | Out-Null
    Assert-RunIdJournalAbsent $RunId
  }
  if ($mode -eq 'ExecuteApprovedPhase') {
    Assert-PhaseApproval $PhaseApproval
    if ([string]::IsNullOrWhiteSpace($RunId)) { throw 'R6_RUN_ID_REQUIRED' }
    if ([string]::IsNullOrWhiteSpace($FinalAuthorizationBindingPath) -or [string]::IsNullOrWhiteSpace($FinalAuthorizationBindingSha256)) { throw 'R6_FINAL_AUTHORIZATION_BINDING_REQUIRED' }
    $confirmationDomain = 'live'
    Assert-RunIdEligible $validation.Path $RunId | Out-Null
    Assert-RunIdJournalAbsent $RunId
  }
  $attestation = Assert-DeploymentAttestation $DeploymentAttestationPath $DeploymentAttestationSha256
  $remainingAttestationMilliseconds = Assert-MinimumAttestationValidity $attestation
  $script:CurrentExecutionAttestationSha256 = $attestation.Sha256
  if ($mode -eq 'ValidateOnly') {
    $evidence = Write-SanitizedEvidence $EvidenceRoot 'validate-only.json' ([ordered]@{ mode = $mode; networkRequests = 0; secretPrompts = 0; runnerInvoked = $false; worktreeHead = $validation.Head; detached = $validation.Detached; baseUrl = $script:ExpectedBaseUrl; attestationSha256 = $attestation.Sha256; deploymentId = $attestation.DeploymentId; attestationRemainingMilliseconds = $remainingAttestationMilliseconds })
    Write-Output "R6_VALIDATE_ONLY_OK:$evidence"
    return
  }
  if ($mode -eq 'DryRunOnly') {
    Assert-TranscriptSafe
    Set-OperatorLauncherStage 'READ_DRYRUN_TOKEN'
    $confirmation = Read-Host 'Fresh dry-run-only confirmation token (hidden)' -AsSecureString
    $confirmationHash = Get-ConfirmationHash $confirmation
  }
  if ($mode -eq 'ExecuteApprovedPhase') {
    Assert-TranscriptSafe
    $confirmation = Read-Host 'Fresh live canary confirmation token (hidden)' -AsSecureString
    $confirmationHash = Get-ConfirmationHash $confirmation
  }
  if ($null -ne $confirmationHash) {
    if ($mode -eq 'ExecuteApprovedPhase') { $reservation = Reserve-ConsumedRun $validation $RunId $confirmationDomain $confirmationHash $FinalAuthorizationBindingPath $FinalAuthorizationBindingSha256 }
    else { $reservation = Reserve-ConsumedRun $validation $RunId $confirmationDomain $confirmationHash }
  }
  $inputs = if ($mode -eq 'DryRunOnly') { Get-FutureInputs -IncludeDryRunTarget } else { Get-FutureInputs }
  $auth = $null
  try {
    $auth = Invoke-PasswordGrant $inputs
    $auth | Add-Member -NotePropertyName AttestationPath -NotePropertyValue $attestation.Path
    $auth | Add-Member -NotePropertyName AttestationSha256 -NotePropertyValue $attestation.Sha256
    if ($mode -eq 'AuthCheckOnly') { Write-Output 'R6_AUTH_CHECK_OK' ; return }
    $targetBindingPath = if ($mode -eq 'ExecuteApprovedPhase') { $FinalAuthorizationBindingPath } else { throw 'QA_CANARY_TARGET_BINDING_REQUIRED' }
    Set-RunnerEnvironment $auth $mode $RunId $reservation '' (Get-ValidatedExecutionCommit $validation) $targetBindingPath
    if ($mode -eq 'DryRunOnly') {
      Invoke-DryRunRunner $validation.Path $RunId ''
      Write-Output 'R6_DRY_RUN_OK'
      return
    }
    if ($mode -eq 'ExecuteApprovedPhase') {
      $executionRoot = $EvidenceRoot
      $childTerminalPath = Join-Path $executionRoot 'minimal-canary-child-terminal-result.json'
      $executionTerminalPath = Join-Path $executionRoot 'final-canary-execution-terminal-result.json'
      $postflightTerminalPath = Join-Path $executionRoot 'final-canary-read-only-postflight-terminal-result.json'
      $orchestrationTerminalPath = Join-Path $executionRoot 'final-canary-execute-and-postflight-orchestration-terminal-result.json'
      $attestationDocument = Read-AttestationJson $attestation.Path
      $startedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      $child = $null
      $journal = $null
      $receiptFinalSha256 = $reservation.ReceiptSha256
      $receiptFinalState = 'PENDING'
      $executionFailure = $null
      $executionFailureStage = 'EXECUTE_CHILD_LAUNCH'
      try {
        Set-RunnerEnvironment $auth $mode $RunId $reservation $childTerminalPath (Get-ValidatedExecutionCommit $validation) $targetBindingPath
        $child = Invoke-LiveRunner $validation.Path $RunId $childTerminalPath
        $journal = Get-ExecutionJournalEvidence (Get-ExpectedJournalRoot) $RunId
        if (Test-Path -LiteralPath $reservation.ReceiptPath -PathType Leaf) {
          $receiptFinalSha256 = Get-Sha256 $reservation.ReceiptPath
          $receiptFinalState = [string](Read-AttestationJson $reservation.ReceiptPath).state
        }
        if (-not (Test-Path -LiteralPath $childTerminalPath -PathType Leaf)) { $executionFailure = 'CHILD_TERMINAL_VALIDATION'; $executionFailureStage = 'EXECUTION_CHILD_TERMINAL' }
        else {
          try { Invoke-FinalNodeValidator $validation.Path 'scripts/qa/validate-production-minimal-canary-child-terminal.mjs' $childTerminalPath 'QA_MINIMAL_CANARY_CHILD_TERMINAL_OK' 'CHILD_TERMINAL_VALIDATION' } catch { $executionFailure = $_.Exception.Message; $executionFailureStage = 'EXECUTION_CHILD_TERMINAL' }
        }
        if ($null -eq $executionFailure -and ($child.ChildTimedOut -or $child.ChildExitCode -ne 0)) { $executionFailure = if ($child.ChildTimedOut) { 'MINIMAL_CANARY_CHILD_LAUNCH' } else { [string]$child.StderrClassification } }
      } catch { $executionFailure = $_.Exception.Message; $executionFailureStage = 'EXECUTE_CHILD_LAUNCH'; $journal = Get-ExecutionJournalEvidence (Get-ExpectedJournalRoot) $RunId }
      $childStarted = $null -ne $child -and [bool]$child.ChildStarted
      $childCompleted = $null -ne $child -and [bool]$child.ChildCompleted
      $childExitCode = if ($null -ne $child) { [int]$child.ChildExitCode } else { 1 }
      $childTimedOut = $null -ne $child -and [bool]$child.ChildTimedOut
      $childValidated = $null -eq $executionFailure -and (Test-Path -LiteralPath $childTerminalPath -PathType Leaf)
      $executionSuccess = $null -eq $executionFailure -and $childExitCode -eq 0 -and $journal.Complete -and $journal.ActualMutationCount -eq 2
      $finalAuthorization = Read-AttestationJson $FinalAuthorizationBindingPath
      $finalReceipt = Read-AttestationJson $reservation.ReceiptPath
      $executionData = [ordered]@{ schemaVersion='r6-final-canary-execution-terminal-result-v2'; startedAt=$startedAt; completedAt=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); outerClassification=(if ($executionSuccess) {'R6_FINAL_CANARY_EXECUTION_COMPLETE'} else {'R6_FINAL_CANARY_EXECUTION_FAILED'}); innerClassification=(if ($executionSuccess) {$null} else {$executionFailure}); failureStage=(if ($executionSuccess) {$null} else {$executionFailureStage}); success=[bool]$executionSuccess; productionRunId=$RunId; parentDryRunRunId=$finalAuthorization.dryRunRunId; executionCommit=$validation.Head; toolingCommit=$validation.Head; actualExecutionWorktreeHead=$validation.Head; dryRunTerminalPath=$finalAuthorization.dryRunTerminalPath; dryRunTerminalSha256=$finalAuthorization.dryRunTerminalSha256; dryRunOrchestrationTerminalPath=$finalAuthorization.dryRunOrchestrationTerminalPath; dryRunOrchestrationTerminalSha256=$finalAuthorization.dryRunOrchestrationTerminalSha256; dryRunBindingPassed=$true; mutationPlanSchema='qa-minimal-canary-mutation-plan-v1'; mutationPlanHash=$finalReceipt.finalAuthorizationBinding.planSha256; targetBinding=$finalAuthorization.targetBinding; approvedMutationCount=2; plannedMutationCount=2; freshAttestationPath=$attestation.Path; freshAttestationSha256=$attestation.Sha256; freshAttestationIssuedAt=[string]$attestationDocument.observedAt; freshAttestationExpiresAt=$attestation.ExpiresAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); attestationFreshnessPassed=$true; liveReceiptPath=$reservation.ReceiptPath; liveReceiptSha256=$receiptFinalSha256; liveReceiptInitialState='PENDING'; liveReceiptFinalState=$receiptFinalState; receiptBindingPassed=($receiptFinalState -eq 'CONSUMED'); executeStarted=$true; executeCompleted=$childCompleted; childStarted=$childStarted; childCompleted=$childCompleted; childExitCode=$childExitCode; childTimedOut=$childTimedOut; childTerminalPath=(if (Test-Path -LiteralPath $childTerminalPath -PathType Leaf) {$childTerminalPath} else {$null}); childTerminalSha256=(if (Test-Path -LiteralPath $childTerminalPath -PathType Leaf) {Get-Sha256 $childTerminalPath} else {$null}); childTerminalValidated=$childValidated; adapterReached=$journal.AdapterReached; journalCreated=$journal.Exists; journalPath=$journal.Path; journalSha256=$journal.Sha256; actualMutationCount=$journal.ActualMutationCount; unexpectedMutationCount=0; retryCount=0; supabaseReadCount=0; supabaseWriteCount=$journal.ActualMutationCount; productionMutationCount=$journal.ActualMutationCount }
      $executionTerminal = Write-FinalCanaryEvidence $executionRoot 'final-canary-execution-terminal-result.json' $executionData
      if ($executionSuccess) {
        try { Invoke-FinalNodeValidator $validation.Path 'scripts/qa/validate-r6-final-canary-execution-terminal.mjs' $executionTerminal 'R6_FINAL_CANARY_EXECUTION_TERMINAL_OK' 'EXECUTION_TERMINAL_FINALIZATION' } catch { $executionFailure = $_.Exception.Message; $executionSuccess = $false }
      }
      $postflightSuccess = $false
      if ($executionSuccess) {
        Push-Location -LiteralPath $validation.Path
        try { $postflightLines = @(& node 'scripts/qa/run-r6-final-canary-read-only-postflight.mjs' '--execution-terminal' $executionTerminal '--execution-terminal-sha256' (Get-Sha256 $executionTerminal) '--receipt' $reservation.ReceiptPath '--receipt-sha256' $receiptFinalSha256 '--registry-root' $reservation.RegistryRoot '--journal-root' (Get-ExpectedJournalRoot) '--output' $postflightTerminalPath '--verify-remote' 2>&1); $postflightExit = $LASTEXITCODE } finally { Pop-Location }
        if ($postflightExit -eq 0 -and (Test-Path -LiteralPath $postflightTerminalPath -PathType Leaf)) {
          try { Invoke-FinalNodeValidator $validation.Path 'scripts/qa/validate-r6-final-canary-postflight.mjs' $postflightTerminalPath 'R6_FINAL_CANARY_POSTFLIGHT_OK' 'POSTFLIGHT_TERMINAL_VALIDATION'; $postflightSuccess = $true } catch { $executionFailure = $_.Exception.Message }
        } else { $executionFailure = 'POSTFLIGHT_EXECUTION' }
      }
      $postflight = if ($postflightSuccess) { Read-AttestationJson $postflightTerminalPath } else { $null }
      $orchestration = [ordered]@{ schemaVersion='r6-final-canary-execute-and-postflight-orchestration-terminal-result-v2'; startedAt=$startedAt; completedAt=[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); outerClassification=(if ($executionSuccess -and $postflightSuccess) {'R6_FINAL_CANARY_EXECUTE_AND_POSTFLIGHT_COMPLETE'} else {'R6_FINAL_CANARY_EXECUTE_AND_POSTFLIGHT_FAILED'}); innerClassification=(if ($executionSuccess -and $postflightSuccess) {$null} else {$executionFailure}); failureStage=(if ($executionSuccess -and $postflightSuccess) {$null} else {'FINAL_ORCHESTRATION'}); success=[bool]($executionSuccess -and $postflightSuccess); parentDryRunRunId=$executionData.parentDryRunRunId; productionRunId=$RunId; targetBinding=$finalAuthorization.targetBinding; dryRunAuthorizationValidated=$true; freshCaptureSuccess=$true; freshAuthCheckSuccess=$true; freshAttestationFreshnessPassed=$true; executeStarted=$true; executeCompleted=$childCompleted; executeSuccess=[bool]$executionSuccess; executionTerminalPath=$executionTerminal; executionTerminalSha256=(Get-Sha256 $executionTerminal); postflightStarted=$executionSuccess; postflightCompleted=$postflightSuccess; postflightSuccess=$postflightSuccess; postflightTerminalPath=(if ($postflightSuccess) {$postflightTerminalPath} else {$null}); postflightTerminalSha256=(if ($postflightSuccess) {Get-Sha256 $postflightTerminalPath} else {$null}); approvedMutationCount=2; actualMutationCount=$journal.ActualMutationCount; verifiedMutationCount=(if ($postflightSuccess) {[int]$postflight.verifiedMutationCount} else {0}); unexpectedMutationCount=(if ($postflightSuccess) {[int]$postflight.unexpectedMutationCount} else {0}); duplicateExecutionCount=(if ($postflightSuccess) {[int]$postflight.duplicateExecutionCount} else {0}); retryCount=0; supabaseReadCount=(if ($postflightSuccess) {[int]$postflight.supabaseReadCount} else {0}); supabaseWriteCount=$journal.ActualMutationCount; productionMutationCount=$journal.ActualMutationCount; postflightWriteCount=(if ($postflightSuccess) {[int]$postflight.supabaseWriteCount} else {0}) }
      $orchestrationTerminal = Write-FinalCanaryEvidence $executionRoot 'final-canary-execute-and-postflight-orchestration-terminal-result.json' $orchestration
      if ($executionSuccess -and $postflightSuccess) { Invoke-FinalNodeValidator $validation.Path 'scripts/qa/validate-r6-final-canary-orchestration-terminal.mjs' $orchestrationTerminal 'R6_FINAL_CANARY_ORCHESTRATION_TERMINAL_OK' 'FINAL_ORCHESTRATION_TERMINAL_VALIDATION'; Write-Output 'R6_FINAL_CANARY_EXECUTE_AND_POSTFLIGHT_COMPLETE'; return }
      throw ('R6_FINAL_CANARY_EXECUTE_AND_POSTFLIGHT_FAILED:' + $executionFailure)
    }
  } finally {
    Clear-RunnerEnvironment
    $auth = $null
    $confirmationHash = $null
    $script:CurrentExecutionAttestationSha256 = $null
  }
}

if ($env:R6_DETACHED_TRANSPORT_LIBRARY_MODE -ne '1') {
  Confirm-OperatorLauncherWrapperEntry
  Set-R6WrapperStage 'POST_ENTRY_INITIALIZATION'
  # The operator-launcher fixture verifies real PowerShell binding, then exits
  # before any mode-specific preflight, credential prompt, or external action.
  try {
    if ($env:R6_OPERATOR_LAUNCH_TEST_MODE -eq '1' -and $env:R6_OPERATOR_LAUNCHER_INERT_TEST_MODE -eq '1') {
      if (-not [string]::IsNullOrWhiteSpace($R6PostEntryTestExistingClassification)) {
        if ($R6PostEntryTestExistingClassification -notmatch '^R6_[A-Z0-9_]+$') { throw 'R6_DETACHED_SECURE_WRAPPER_TEST_CLASSIFICATION_INVALID' }
        throw $R6PostEntryTestExistingClassification
      }
      if (-not [string]::IsNullOrWhiteSpace($R6PostEntryTestFailpoint)) {
        if ($R6PostEntryTestFailpoint -notin @('MODE_RESOLUTION','FIXED_BINDING_VALIDATION','GIT_EXECUTABLE_RESOLUTION','DETACHED_WORKTREE_VALIDATION','BLOB_AND_RAW_HASH_VALIDATION','EVIDENCE_ROOT_VALIDATION','SECRET_ENVIRONMENT_GUARD','CAPTURE_COMMAND_PREPARATION')) { throw 'R6_DETACHED_SECURE_WRAPPER_TEST_FAILPOINT_INVALID' }
        Set-R6WrapperStage $R6PostEntryTestFailpoint
        throw 'R6_DETACHED_SECURE_WRAPPER_POST_ENTRY_UNCLASSIFIED_FAILURE'
      }
      throw 'R6_OPERATOR_LAUNCH_WRAPPER_INERT_STOPPED'
    }
    if (-not [string]::IsNullOrWhiteSpace($R6PostEntryTestFailpoint) -or -not [string]::IsNullOrWhiteSpace($R6PostEntryTestExistingClassification)) { throw 'R6_DETACHED_SECURE_WRAPPER_TEST_FAILPOINT_LIVE_REJECTED' }
    Invoke-Main
  } catch {
    $inner = Get-ValueBlindFailureCode $_ 'R6_DETACHED_SECURE_WRAPPER_POST_ENTRY_UNCLASSIFIED_FAILURE'
    Write-R6WrapperPostEntryDiagnostic $_ $inner
    throw $inner
  }
  $global:LASTEXITCODE = 0
}
