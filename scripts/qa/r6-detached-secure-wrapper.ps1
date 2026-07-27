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
  [string]$V3TerminalFixturePath,
  [string]$RunId,
  [string]$PhaseApproval,
  [string]$EvidenceRoot = 'C:\Users\1\OpenGlassHub-R6-Proof\r6-detached-secure-input-transport'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
$script:V3FinalCommitBinding = '989ec80672b1b62861d55c39385d0f2a369f9ab5'
$script:V3RuntimeRawSha256Binding = '53b5e8dc693090fa7c460874c484bb09f7a7d94049d477eac401d51433c14cfd'
$script:V3GitBlobBinding = '5ce532ad04115738c5e79ab7ec020f31a23a9a64'
$script:V3RunnerRelativePath = 'scripts\qa\run-cloudflare-pages-current-canonical-production-v3-preparation.mjs'
$script:V3TerminalValidatorRelativePath = 'scripts\qa\validate-r6-current-canonical-production-v3-terminal.mjs'
$script:V3EvidenceRootBase = 'C:\Users\1\OpenGlassHub-R6-Proof\r6-current-canonical-production-v3-evidence'
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
  'QA_CANARY_ACCESS_TOKEN', 'QA_CANARY_SUPABASE_ANON_KEY', 'QA_CANARY_CIRCLE_SLUG',
  'QA_ALLOW_PRODUCTION_WRITES', 'QA_CANARY_APPROVAL', 'QA_CANARY_JOURNAL_ROOT',
  'QA_CANARY_CONSUMED_RUN_REGISTRY_ROOT', 'QA_CANARY_CONSUMED_RUN_RECEIPT_PATH',
  'QA_CANARY_CONSUMED_RUN_RECEIPT_SHA256', 'QA_CANARY_CONSUMED_RUN_NONCE',
  'QA_CANARY_WRAPPER_VERSION', 'QA_CANARY_WRAPPER_SHA256', 'QA_CANARY_CHILD_COMMAND_SHA256'
)

function Get-Sha256([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "R6_REQUIRED_FILE_MISSING:$Path" }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Invoke-GitLines([string]$Worktree, [string[]]$Arguments, [switch]$AllowFailure) {
  $lines = @(& git -C $Worktree @Arguments 2>&1)
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
  $arguments = @('--operation','PREPARE_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Worktree,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$EvidenceRoot,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$PSCommandPath,'--execution-worktree',$Worktree,'--tooling-commit',$script:ExpectedRunnerCommit,'--wrapper-sha256',(Get-Sha256 $PSCommandPath),'--transport-sha256',$transport,'--parser-selector-sha256',$resolver,'--deployment-id','6f11bcf1-65a7-4e9c-aa25-30ec1fd7fb8a','--source-commit',$script:ExpectedDeployedCommit)
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
  $arguments = @('--operation','PREPARE_PROJECT_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Worktree,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$EvidenceRoot,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$PSCommandPath,'--execution-worktree',$Worktree,'--tooling-commit',$script:ExpectedRunnerCommit,'--wrapper-sha256',(Get-Sha256 $PSCommandPath),'--transport-sha256',$transport,'--parser-selector-sha256',$parserSelector)
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
  $arguments = @('--operation','PREPARE_PROJECT_R2_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Worktree,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$EvidenceRoot,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$PSCommandPath,'--execution-worktree',$Worktree,'--tooling-commit',$script:ExpectedRunnerCommit,'--wrapper-sha256',(Get-Sha256 $PSCommandPath),'--transport-sha256',$transport,'--parser-selector-sha256',$parserSelector)
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

function Get-ValueBlindFailureCode([object]$ErrorRecord) {
  foreach ($value in @([string]$ErrorRecord.Exception.Message, [string]$ErrorRecord.FullyQualifiedErrorId, [string]$ErrorRecord)) {
    if ($value -match '(R6_[A-Z0-9_]+)') { return $Matches[1] }
  }
  return 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_UNEXPECTED_FAILURE'
}

function Convert-StrictUtcTimestamp([string]$Value, [string]$FailureCode) {
  if ($Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$') { throw $FailureCode }
  try {
    return [DateTimeOffset]::Parse(
      $Value,
      [Globalization.CultureInfo]::InvariantCulture,
      ([Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
    )
  } catch { throw $FailureCode }
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
  $State.schemaVersion = 'r6-auth-check-only-terminal-result-v1'
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
    credentialPromptReached = $false; otpPromptReached = $false; authenticationAttempted = $false; authenticationCompleted = $false; sessionCreated = $false; sessionValidated = $false; authenticatedCheckReached = $false; authenticatedCheckCompleted = $false
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
      $state.credentialPromptReached = $true; $state.authenticationAttempted = $true; $state.authenticationCompleted = $true; $state.sessionCreated = $true; $state.sessionValidated = $true; $state.authenticatedCheckReached = $true; $state.authenticatedCheckCompleted = $true; $state.childStarted = $true; $state.childExitCode = 0
    } else {
      $state.credentialPromptReached = $true; $inputs = Get-FutureInputs; $state.authenticationAttempted = $true; $auth = Invoke-PasswordGrant $inputs; $state.authenticationCompleted = $true; $state.sessionCreated = $true; $state.sessionValidated = $true; $state.authenticatedCheckReached = $true; $state.authenticatedCheckCompleted = $true; $state.childStarted = $true; $state.childExitCode = 0; $auth = $null
    }
    $state.failureStage = 'complete'; $state.exceptionType = $null; $state.outerClassification = 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_OK'; $state.success = $true
  } catch {
    $state.outerClassification = 'R6_CURRENT_CANONICAL_V3_AUTH_CHECK_ONLY_FAILED'; $state.innerClassification = Get-ValueBlindFailureCode $_; $state.exceptionType = $_.Exception.GetType().FullName
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

function Assert-CurrentCanonicalProductionV3TerminalFreshness([pscustomobject]$Terminal) {
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
  $remainingNow = ($expires - [DateTimeOffset]::UtcNow).TotalMilliseconds
  if ($remainingNow -lt [int64]$Terminal.minimumValidityMilliseconds) { throw 'R6_CURRENT_CANONICAL_V3_TERMINAL_FRESHNESS_INVALID' }
  return [math]::Floor($remainingNow)
}

function Invoke-PrepareCurrentCanonicalProductionV3AuthDryRunAttestation([pscustomobject]$Validation) {
  if (-not [string]::IsNullOrWhiteSpace($V3TerminalFixturePath)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE_REQUIRED' }
  Assert-TranscriptSafe
  $root = Assert-CurrentCanonicalProductionV3EvidenceRoot $EvidenceRoot
  $transport = Get-Sha256 (Join-Path $Validation.Path 'scripts\qa\cloudflare-pages-project-v3-get.mjs')
  $entrypoint = $Validation.Runner
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $terminalResultPath = Join-Path $root 'current-canonical-production-v3-metadata-preparation-terminal-result.json'
  $arguments = @('--operation','PREPARE_CURRENT_CANONICAL_PRODUCTION_V3_AUTH_DRY_RUN_ATTESTATION','--repository-root',$Validation.Path,'--attestation-root',$script:ExpectedAttestationRoot,'--registry-root',$script:ConsumedRunRegistryRoot,'--journal-root',(Get-ExpectedJournalRoot),'--evidence-root',$root,'--terminal-result-path',$terminalResultPath,'--wrapper-path',$PSCommandPath,'--execution-worktree',$Validation.Path,'--tooling-commit',$script:V3FinalCommitBinding,'--wrapper-sha256',(Get-Sha256 $PSCommandPath),'--transport-sha256',$transport,'--parser-selector-sha256',$transport,'--command-output-mode','wrapper-buffered')
  $exitCode = $null
  Push-Location -LiteralPath $Validation.Path
  try { $previousErrorActionPreference = $ErrorActionPreference; try { $ErrorActionPreference = 'Continue'; & node $entrypoint @arguments; $exitCode = $LASTEXITCODE } finally { $ErrorActionPreference = $previousErrorActionPreference } } finally { Pop-Location }
  if (-not (Test-Path -LiteralPath $terminalResultPath -PathType Leaf)) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_TERMINAL_MISSING' }
  $validatorResult = Invoke-CurrentCanonicalProductionV3TerminalValidator $Validation $terminalResultPath $root
  $terminal = Read-AttestationJson $terminalResultPath
  if ($null -eq $exitCode -or $exitCode -ne [int]$terminal.childExitCode) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  if ($validatorResult -eq 'R6_CURRENT_CANONICAL_V3_TERMINAL_FAILURE') { throw ([string]$terminal.outerClassification) }
  if ($terminal.outerClassification -ne 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY') { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  Assert-CurrentCanonicalProductionV3TerminalFreshness $terminal | Out-Null
  $commands = @($terminal.commands | ForEach-Object { [string]$_ })
  if ($commands.Count -ne 2) { throw 'R6_CURRENT_CANONICAL_V3_WRAPPER_IMPOSSIBLE_STATE' }
  Write-Output 'R6_HARDENED_PAGES_CURRENT_CANONICAL_PRODUCTION_V3_CAPTURE_HUMAN_COMMAND_READY'
  foreach ($command in $commands) { Write-Output $command }
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
  $selected = @($ValidateOnly, $AuthCheckOnly, $DryRunOnly, $ExecuteApprovedPhase, $PrepareAuthDryRunAttestation, $PreparePagesProjectAuthDryRunAttestation, $PreparePagesProjectR2AuthDryRunAttestation, $PrepareCurrentCanonicalProductionV3AuthDryRunAttestation | Where-Object { $_ })
  if ($selected.Count -ne 1) { throw 'R6_MODE_REQUIRED_EXACTLY_ONCE' }
  if ($ValidateOnly) { return 'ValidateOnly' }
  if ($AuthCheckOnly) { return 'AuthCheckOnly' }
  if ($DryRunOnly) { return 'DryRunOnly' }
  if ($PrepareAuthDryRunAttestation) { return 'PrepareAuthDryRunAttestation' }
  if ($PreparePagesProjectAuthDryRunAttestation) { return 'PreparePagesProjectAuthDryRunAttestation' }
  if ($PreparePagesProjectR2AuthDryRunAttestation) { return 'PreparePagesProjectR2AuthDryRunAttestation' }
  if ($PrepareCurrentCanonicalProductionV3AuthDryRunAttestation) { return 'PrepareCurrentCanonicalProductionV3AuthDryRunAttestation' }
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

function Reserve-ConsumedRun([string]$Worktree, [string]$RequestedRunId, [ValidateSet('dry-run', 'live')][string]$Domain, [string]$ConfirmationHash) {
  $wrapperHash = Get-Sha256 $PSCommandPath
  $childCommandDigest = Get-ChildCommandDigest $Domain $RequestedRunId
  $result = Invoke-ConsumedRunTool $Worktree @('--registry-root', $script:ConsumedRunRegistryRoot, '--run-id', $RequestedRunId, '--mode', $Domain, '--confirmation-token-sha256', $ConfirmationHash, '--runner-commit', $script:ExpectedRunnerCommit, '--wrapper-version', $script:ConsumedRunWrapperVersion, '--wrapper-sha256', $wrapperHash, '--child-command-digest', $childCommandDigest)
  if ([string]::IsNullOrWhiteSpace([string]$result.receiptPath) -or [string]$result.receiptSha256 -notmatch '^[a-f0-9]{64}$' -or [string]$result.invocationNonce -notmatch '^[a-f0-9-]{36}$') { throw 'R6_CONSUMED_RUN_RESERVATION_OUTPUT_INVALID' }
  return [pscustomobject]@{ RegistryRoot = $script:ConsumedRunRegistryRoot; ReceiptPath = [string]$result.receiptPath; ReceiptSha256 = [string]$result.receiptSha256; InvocationNonce = [string]$result.invocationNonce; WrapperSha256 = $wrapperHash; ChildCommandDigest = $childCommandDigest }
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
    if ($value.toolingCommit -ne $script:ExpectedRunnerCommit -or $value.wrapperSha256 -ne (Get-Sha256 $PSCommandPath) -or $value.projectSourceContractSha256 -ne '7d3a3650c5c6c47296164335aa41f4020ca5d34e148f9045fe62ef86d6ba81a0') { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
    if ($value.productionBranch -ne 'main' -or $value.triggerBranch -ne 'main' -or $value.isSkipped -ne $false -or $value.latestStageName -ne 'deploy' -or $value.latestStageStatus -ne 'success') { throw 'R6_ATTESTATION_TARGET_MISMATCH' }
    foreach ($digest in @($value.transportSha256, $value.parserSelectorSha256, $value.endpointSha256, $value.accountIdSha256, $value.sanitizedMetadataSha256)) { if ([string]$digest -notmatch '^[a-f0-9]{64}$') { throw 'R6_ATTESTATION_SCHEMA_INVALID' } }
  }
  if ($value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V2' -or $value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V3') {
    $expectedToolingCommit = if ($value.evidenceType -eq 'CLOUDFLARE_PAGES_PROJECT_GET_V3') { $script:V3FinalCommitBinding } else { $script:ExpectedRunnerCommit }
    if ($value.toolingCommit -ne $expectedToolingCommit -or $value.wrapperSha256 -ne (Get-Sha256 $PSCommandPath) -or $value.wrapperVersion -ne 'r6-consumed-run-wrapper-v1') { throw 'R6_ATTESTATION_SCHEMA_INVALID' }
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
  $now = [DateTimeOffset]::UtcNow
  if ($observed.Offset -ne [TimeSpan]::Zero -or $expires.Offset -ne [TimeSpan]::Zero -or $observed -gt $now -or $expires -le $observed -or ($expires - $observed).TotalMinutes -gt 15 -or $expires -lt $now) { throw 'R6_ATTESTATION_STALE' }
  return [pscustomobject]@{ Path = $resolved; Sha256 = $actualHash; DeploymentId = [string]$value.deploymentId; SourceCommit = [string]$value.sourceCommit; ExpiresAt = $expires }
}

function Assert-MinimumAttestationValidity([pscustomobject]$Attestation) {
  $remaining = ($Attestation.ExpiresAt - [DateTimeOffset]::UtcNow).TotalMilliseconds
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

function Get-FutureInputs {
  Assert-TranscriptSafe
  $projectRef = Assert-ProjectRef (Read-Host 'Production Supabase project ref')
  $anonSecure = Read-Host 'Production anon/public key (hidden)' -AsSecureString
  $email = Assert-NonBlank (Read-Host 'Dedicated QA email') 'qa-email'
  Write-Host 'Enter the OpenGlass Hub / Supabase QA account password (not the mailbox password).' -ForegroundColor Yellow
  $passwordSecure = Read-Host 'OpenGlass Hub / Supabase QA account password (not mailbox password)' -AsSecureString
  $circleSlug = Assert-CircleSlug (Read-Host 'Approved existing circle slug')
  return [pscustomobject]@{ ProjectRef = $projectRef; AnonSecure = $anonSecure; Email = $email; PasswordSecure = $passwordSecure; CircleSlug = $circleSlug }
}

function Invoke-PasswordGrant([pscustomobject]$Inputs) {
  $anon = $null; $password = $null
  try {
    $anon = Convert-SecureStringToPlaintext $Inputs.AnonSecure
    $password = Convert-SecureStringToPlaintext $Inputs.PasswordSecure
    if ([string]::IsNullOrWhiteSpace($anon) -or (Test-ServiceRoleLookingKey $anon)) { throw 'R6_ANON_KEY_REJECTED' }
    $endpoint = "https://$($Inputs.ProjectRef).supabase.co/auth/v1/token?grant_type=password"
    $body = @{ email = $Inputs.Email; password = $password } | ConvertTo-Json -Compress
    $headers = @{ apikey = $anon; 'Content-Type' = 'application/json' }
    try { $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -Body $body -ErrorAction Stop }
    catch { throw 'R6_AUTH_NETWORK_OR_REJECTED' }
    $accessToken = [string]$response.access_token
    $userId = [string]$response.user.id
    $confirmed = -not [string]::IsNullOrWhiteSpace([string]$response.user.email_confirmed_at)
    if ([string]::IsNullOrWhiteSpace($accessToken) -or $userId -notmatch '^[0-9a-f]{8}-[0-9a-f-]{27,}$' -or -not $confirmed) { throw 'R6_AUTH_RESPONSE_MALFORMED_OR_UNCONFIRMED' }
    return [pscustomobject]@{ AccessToken = $accessToken; UserId = $userId; AnonKey = $anon; ProjectRef = $Inputs.ProjectRef; CircleSlug = $Inputs.CircleSlug }
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

function Set-RunnerEnvironment([pscustomobject]$Auth, [string]$Mode, [string]$RequestedRunId, [pscustomobject]$Reservation) {
  Assert-NoPreexistingSecrets
  [Environment]::SetEnvironmentVariable('QA_SUPABASE_URL', "https://$($Auth.ProjectRef).supabase.co", 'Process')
  [Environment]::SetEnvironmentVariable('QA_EXPECTED_SUPABASE_REF', $Auth.ProjectRef, 'Process')
  [Environment]::SetEnvironmentVariable('QA_PRODUCTION_SUPABASE_REF', $Auth.ProjectRef, 'Process')
  [Environment]::SetEnvironmentVariable('QA_BASE_URL', $script:ExpectedBaseUrl, 'Process')
  [Environment]::SetEnvironmentVariable('QA_EXPECTED_RUNNER_COMMIT', $script:ExpectedRunnerCommit, 'Process')
  [Environment]::SetEnvironmentVariable('QA_EXPECTED_DEPLOYED_COMMIT', $script:ExpectedDeployedCommit, 'Process')
  [Environment]::SetEnvironmentVariable('QA_DEPLOYMENT_ATTESTATION_PATH', $Auth.AttestationPath, 'Process')
  [Environment]::SetEnvironmentVariable('QA_DEPLOYMENT_ATTESTATION_SHA256', $Auth.AttestationSha256, 'Process')
  [Environment]::SetEnvironmentVariable('QA_CANARY_ACCESS_TOKEN', $Auth.AccessToken, 'Process')
  [Environment]::SetEnvironmentVariable('QA_CANARY_SUPABASE_ANON_KEY', $Auth.AnonKey, 'Process')
  [Environment]::SetEnvironmentVariable('QA_CANARY_CIRCLE_SLUG', $Auth.CircleSlug, 'Process')
  [Environment]::SetEnvironmentVariable('QA_CANARY_JOURNAL_ROOT', (Get-ExpectedJournalRoot), 'Process')
  if ($null -ne $Reservation) {
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_REGISTRY_ROOT', $Reservation.RegistryRoot, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_RECEIPT_PATH', $Reservation.ReceiptPath, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_RECEIPT_SHA256', $Reservation.ReceiptSha256, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CONSUMED_RUN_NONCE', $Reservation.InvocationNonce, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_WRAPPER_VERSION', $script:ConsumedRunWrapperVersion, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_WRAPPER_SHA256', $Reservation.WrapperSha256, 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_CHILD_COMMAND_SHA256', $Reservation.ChildCommandDigest, 'Process')
  }
  if ($Mode -eq 'ExecuteApprovedPhase') {
    [Environment]::SetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', '1', 'Process')
    [Environment]::SetEnvironmentVariable('QA_CANARY_APPROVAL', $script:RunnerApproval, 'Process')
  }
}

function Invoke-CommittedRunner([string]$Worktree, [string[]]$Arguments) {
  Push-Location -LiteralPath $Worktree
  try {
    & node $script:RunnerRelativePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'R6_COMMITTED_RUNNER_FAILED' }
  } finally { Pop-Location }
}

function Invoke-DryRunRunner([string]$Worktree, [string]$RequestedRunId, [scriptblock]$ChildRunner = $null) {
  if ($RequestedRunId -notmatch '^qa-canary-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'R6_DRY_RUN_ID_INVALID' }
  # The target guard reads --confirm-run before the runner selects its dry-run return branch.
  # A dry-run's unique run ID is therefore its fresh runner-level confirmation identity.
  $arguments = @('--dry-run', '--run-id', $RequestedRunId, '--confirm-run', $RequestedRunId)
  if ($arguments -notcontains '--dry-run' -or $arguments -contains '--execute' -or $arguments -contains '--recover-run') { throw 'R6_DRY_RUN_ARGUMENTS_UNSAFE' }
  if (-not [string]::IsNullOrWhiteSpace([string][Environment]::GetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', 'Process'))) { throw 'R6_DRY_RUN_FLAG_PREEXISTING' }
  try {
    # This is only the b9 target-guard acknowledgement. The exact runner returns before adapter creation.
    [Environment]::SetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', '1', 'Process')
    if ([string][Environment]::GetEnvironmentVariable('QA_ALLOW_PRODUCTION_WRITES', 'Process') -ne '1') { throw 'R6_DRY_RUN_FLAG_SET_FAILED' }
    if ($null -ne $ChildRunner) { & $ChildRunner -RunnerArgs $arguments }
    else { Invoke-CommittedRunner $Worktree $arguments }
  } finally {
    Remove-Item -LiteralPath 'Env:QA_ALLOW_PRODUCTION_WRITES' -ErrorAction SilentlyContinue
  }
}

function Invoke-Main {
  $mode = Get-Mode
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
    $confirmationDomain = 'live'
    Assert-RunIdEligible $validation.Path $RunId | Out-Null
    Assert-RunIdJournalAbsent $RunId
  }
  $attestation = Assert-DeploymentAttestation $DeploymentAttestationPath $DeploymentAttestationSha256
  $remainingAttestationMilliseconds = Assert-MinimumAttestationValidity $attestation
  if ($mode -eq 'ValidateOnly') {
    $evidence = Write-SanitizedEvidence $EvidenceRoot 'validate-only.json' ([ordered]@{ mode = $mode; networkRequests = 0; secretPrompts = 0; runnerInvoked = $false; worktreeHead = $validation.Head; detached = $validation.Detached; baseUrl = $script:ExpectedBaseUrl; attestationSha256 = $attestation.Sha256; deploymentId = $attestation.DeploymentId; attestationRemainingMilliseconds = $remainingAttestationMilliseconds })
    Write-Output "R6_VALIDATE_ONLY_OK:$evidence"
    return
  }
  if ($mode -eq 'DryRunOnly') {
    Assert-TranscriptSafe
    $confirmation = Read-Host 'Fresh dry-run-only confirmation token (hidden)' -AsSecureString
    $confirmationHash = Get-ConfirmationHash $confirmation
  }
  if ($mode -eq 'ExecuteApprovedPhase') {
    Assert-TranscriptSafe
    $confirmation = Read-Host 'Fresh live canary confirmation token (hidden)' -AsSecureString
    $confirmationHash = Get-ConfirmationHash $confirmation
  }
  if ($null -ne $confirmationHash) { $reservation = Reserve-ConsumedRun $validation.Path $RunId $confirmationDomain $confirmationHash }
  $inputs = Get-FutureInputs
  $auth = $null
  try {
    $auth = Invoke-PasswordGrant $inputs
    $auth | Add-Member -NotePropertyName AttestationPath -NotePropertyValue $attestation.Path
    $auth | Add-Member -NotePropertyName AttestationSha256 -NotePropertyValue $attestation.Sha256
    if ($mode -eq 'AuthCheckOnly') { Write-Output 'R6_AUTH_CHECK_OK' ; return }
    Set-RunnerEnvironment $auth $mode $RunId $reservation
    if ($mode -eq 'DryRunOnly') {
      Invoke-DryRunRunner $validation.Path $RunId
      Write-Output 'R6_DRY_RUN_OK'
      return
    }
    if ($mode -eq 'ExecuteApprovedPhase') {
      Invoke-CommittedRunner $validation.Path @('--execute', '--run-id', $RunId, '--confirm-run', $RunId)
    }
  } finally {
    Clear-RunnerEnvironment
    $auth = $null
    $confirmationHash = $null
  }
}

if ($env:R6_DETACHED_TRANSPORT_LIBRARY_MODE -ne '1') {
  Invoke-Main
  $global:LASTEXITCODE = 0
}
