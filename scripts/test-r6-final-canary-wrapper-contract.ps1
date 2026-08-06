param([string]$WrapperPath = (Join-Path $PSScriptRoot 'qa\r6-detached-secure-wrapper.ps1'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
$source = Get-Content -LiteralPath $WrapperPath -Raw
Require ($source -match 'function Invoke-LiveRunner') 'R6_FINAL_WRAPPER_LIVE_CHILD_HELPER_MISSING'
Require ($source -match 'Invoke-R6NativeChildProcess') 'R6_FINAL_WRAPPER_NATIVE_CHILD_REQUIRED'
Require ($source -match 'minimal-canary-child-terminal-result\.json') 'R6_FINAL_WRAPPER_CHILD_TERMINAL_REQUIRED'
Require ($source -match 'function Write-FinalCanaryEvidence') 'R6_FINAL_WRAPPER_ATOMIC_EVIDENCE_WRITER_MISSING'
Require ($source -match '\[IO\.File\]::Move\(\$temporary, \$file\)') 'R6_FINAL_WRAPPER_ATOMIC_EVIDENCE_RENAME_REQUIRED'
Require ($source -match 'validate-r6-final-canary-execution-terminal\.mjs') 'R6_FINAL_WRAPPER_EXECUTION_VALIDATOR_MISSING'
Require ($source -match 'run-r6-final-canary-read-only-postflight\.mjs') 'R6_FINAL_WRAPPER_POSTFLIGHT_RUNNER_MISSING'
Require ($source -match "'--verify-remote'") 'R6_FINAL_WRAPPER_READ_ONLY_POSTFLIGHT_REQUIRED'
Require ($source -match 'validate-r6-final-canary-postflight\.mjs') 'R6_FINAL_WRAPPER_POSTFLIGHT_VALIDATOR_MISSING'
Require ($source -match 'validate-r6-final-canary-orchestration-terminal\.mjs') 'R6_FINAL_WRAPPER_ORCHESTRATION_VALIDATOR_MISSING'
Require ($source -match 'if \(\$executionSuccess\) \{[\s\S]*\$postflightSuccess') 'R6_FINAL_WRAPPER_POSTFLIGHT_AFTER_EXECUTION_ONLY'
Require ($source -match 'actualMutationCount -eq 2') 'R6_FINAL_WRAPPER_PARTIAL_EXECUTION_GUARD_MISSING'
Require ($source -notmatch 'Invoke-CommittedRunner \$validation\.Path @\(''--execute''') 'R6_FINAL_WRAPPER_LEGACY_UNTERMINALLED_EXECUTE_PRESENT'
Require ($source -match 'Clear-RunnerEnvironment') 'R6_FINAL_WRAPPER_SECRET_CLEANUP_MISSING'
Require ($source -match 'PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight') 'R6_FINAL_WRAPPER_SINGLE_COMMAND_MODE_MISSING'
Require ($source -match 'function Assert-FinalExecutionWorktree') 'R6_FINAL_WRAPPER_EXPLICIT_WORKTREE_BINDING_MISSING'
Require ($source -match 'function Assert-FinalParentDryRunAuthorization') 'R6_FINAL_WRAPPER_PARENT_DRY_RUN_PREFLIGHT_MISSING'
Require ($source -match 'R6_FINAL_LOCAL_BINDING_REQUIRED') 'R6_FINAL_WRAPPER_MISSING_BINDING_FAIL_CLOSED_MISSING'
Require ($source -match '\$mode -eq ''ExecuteApprovedPhase'' -and \$null -ne \$script:FinalExecutionBinding') 'R6_FINAL_WRAPPER_FINAL_PROFILE_SELECTION_MISSING'
Require ($source -match '\$validation = Assert-ExecutionWorktree \$ExecutionWorktree \$RunId') 'R6_FINAL_WRAPPER_LEGACY_PROFILE_REGRESSION_MISSING'
foreach ($relative in @('prepare-r6-final-execution-binding.mjs', 'r6-final-execution-binding-issuer.mjs', 'r6-final-execution-binding.mjs', 'r6-final-execution-binding-reissue.mjs', 'validate-r6-final-execution-binding.mjs', 'validate-r6-final-parent-dryrun-same-commit.mjs', 'r6-production-package-contract.mjs', 'validate-legal-local-nonproduction-target.mjs', 'validate-legal-local-rebuild-restore-evidence.mjs', 'validate-legal-local-migration-replay-contract.mjs', 'evaluate-legal-predeployment-readiness.mjs', 'run-legal-local-predeployment-replay.mjs')) {
  Require ($source -match [regex]::Escape("scripts\qa\$relative")) "R6_FINAL_WRAPPER_REVIEWED_BINDING_BLOB_MISSING:$relative"
}
foreach ($relative in @('scripts\lib\legal-nonproduction-target-binding.mjs', 'scripts\lib\legal-local-execution-approval.mjs', 'scripts\lib\legal-local-task-consumption-registry.mjs', 'scripts\lib\legal-local-predeployment-orchestrator.mjs', 'scripts\lib\legal-local-docker-adapter.mjs', 'scripts\lib\legal-local-prelegal-baseline.mjs', 'scripts\lib\legal-local-migration-diagnostics.mjs', 'scripts\lib\legal-local-replay-evidence.mjs', 'scripts\lib\legal-local-smoke-runner.mjs', 'scripts\lib\legal-local-resource-cleanup.mjs', 'scripts\test-legal-consent-predeployment-readiness.mjs')) {
  Require ($source -match [regex]::Escape($relative)) "R6_FINAL_WRAPPER_REVIEWED_BINDING_BLOB_MISSING:$relative"
}
$finalFunction = [regex]::Match($source, 'function Invoke-PrepareCurrentCanonicalProductionV3FinalExecuteAndPostflight[\s\S]*?\nfunction Invoke-Main')
Require ($finalFunction.Success -and $finalFunction.Value -notmatch '\$script:ExpectedExecutionWorktree|\$script:ExpectedRunnerCommit') 'R6_FINAL_WRAPPER_FINAL_MODE_LEGACY_WORKTREE_LEAK'
Require ($finalFunction.Success -and $finalFunction.Value -notmatch 'New-Item -ItemType Directory -Path \$root') 'R6_FINAL_WRAPPER_FINAL_MODE_CAPTURE_ROOT_OWNERSHIP_REGRESSION'
Write-Output 'R6_FINAL_CANARY_WRAPPER_CONTRACT_OK PowerShell-5.1 static fake contract validates separated child channels, atomic evidence, strict validators, read-only postflight, and no legacy live invocation'
