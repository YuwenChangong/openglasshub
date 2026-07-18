[CmdletBinding()]
param(
  [string]$WrapperPath = $env:R6_CONSUMED_RUN_WRAPPER_PATH
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($WrapperPath)) { $WrapperPath = 'C:\Users\1\OpenGlassHub-R6-Proof\start-r6-detached-secure.ps1' }
$source = Get-Content -LiteralPath $WrapperPath -Raw
function Assert-Match([string]$Pattern, [string]$Message) { if ($source -notmatch $Pattern) { throw "R6_WRAPPER_TEST_ASSERTION_FAILED:$Message" } }
function Assert-NotMatch([string]$Pattern, [string]$Message) { if ($source -match $Pattern) { throw "R6_WRAPPER_TEST_ASSERTION_FAILED:$Message" } }

Assert-Match 'metadata-preparation-terminal-result\.json' 'one terminal result path is required'
Assert-Match "'--terminal-result-path'" 'the child must receive the result path explicitly'
Assert-Match '& node \$entrypoint @arguments' 'Node must retain the inherited console'
Assert-NotMatch '& node \$entrypoint @arguments 1>' 'Node stdout must not be redirected away from the TTY'
Assert-Match 'R6_HARDENED_OFFICIAL_GET_RESULT_MISSING' 'missing result must fail closed'
Assert-Match 'R6_HARDENED_OFFICIAL_GET_RESULT_INVALID' 'invalid result must fail closed'
Assert-Match 'R6_HARDENED_OFFICIAL_GET_CHILD_PROCESS_FAILED' 'nonzero child exit must fail closed'
Assert-Match '\$exitCode = \$LASTEXITCODE' 'the child exit code must be captured immediately'
Assert-Match 'outerClassification -ne' 'successful child result must have the exact outer classification'
Assert-Match 'commands\.Count -ne 2' 'only exactly two safe follow-up commands are accepted'
Assert-Match 'ExecuteApprovedPhase' 'live commands are rejected from the result contract'
Assert-Match 'Get-Content -LiteralPath \$terminalResultPath -Raw' 'the wrapper drains the final result after child completion'
Write-Output 'R6_METADATA_WRAPPER_OUTPUT_CONTRACT_OK inherited TTY, one-shot terminal result, result validation, immediate child exit capture, and stable blockers passed with no child invocation or network'
