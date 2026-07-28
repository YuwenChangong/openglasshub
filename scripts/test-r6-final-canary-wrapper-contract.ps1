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
Write-Output 'R6_FINAL_CANARY_WRAPPER_CONTRACT_OK PowerShell-5.1 static fake contract validates separated child channels, atomic evidence, strict validators, read-only postflight, and no legacy live invocation'
