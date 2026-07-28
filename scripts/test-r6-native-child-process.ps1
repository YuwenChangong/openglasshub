[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require([bool]$Condition, [string]$Code) {
  if (-not $Condition) { throw $Code }
}

$module = Join-Path $PSScriptRoot 'qa\r6-native-child-process.psm1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('r6-native-child-process-' + [guid]::NewGuid().ToString())
try {
  Import-Module -Name $module -Force -ErrorAction Stop
  New-Item -ItemType Directory -Path $root | Out-Null
  $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
  $writeFixture = {
    param([string]$Name, [string]$Body)
    $path = Join-Path $root $Name
    [IO.File]::WriteAllText($path, $Body, [Text.UTF8Encoding]::new($false))
    return $path
  }
  $success = & $writeFixture 'success.mjs' 'process.stdout.write("QA_CANARY_DRY_RUN_PLAN_READY\\n");'
  $successResult = Invoke-R6NativeChildProcess -FileName $node -Arguments @($success) -WorkingDirectory $root -TimeoutMilliseconds 5000
  Require ($successResult.ChildStarted -and $successResult.ChildCompleted -and -not $successResult.ChildTimedOut -and $successResult.ChildExitCode -eq 0 -and $successResult.StdoutClassification -eq 'QA_CANARY_DRY_RUN_PLAN_READY' -and $null -eq $successResult.StderrClassification) 'R6_NATIVE_CHILD_PROCESS_STDOUT_FAILED'
  $stderr = & $writeFixture 'stderr.mjs' 'process.stderr.write("QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISSING\\n"); process.exitCode = 1;'
  $stderrResult = Invoke-R6NativeChildProcess -FileName $node -Arguments @($stderr) -WorkingDirectory $root -TimeoutMilliseconds 5000
  Require ($stderrResult.ChildExitCode -eq 1 -and $stderrResult.StderrClassification -eq 'QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISSING' -and $null -eq $stderrResult.StdoutClassification) 'R6_NATIVE_CHILD_PROCESS_STDERR_FAILED'
  $both = & $writeFixture 'both.mjs' 'process.stdout.write("QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH\\n"); process.stderr.write("localized prefix: QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH\\n"); process.exitCode = 1;'
  $bothResult = Invoke-R6NativeChildProcess -FileName $node -Arguments @($both) -WorkingDirectory $root -TimeoutMilliseconds 5000
  Require ($bothResult.ChildExitCode -eq 1 -and $bothResult.StdoutClassification -eq 'QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH' -and $bothResult.StderrClassification -eq 'QA_CANARY_V3_ATTESTATION_TOOLING_COMMIT_MISMATCH') 'R6_NATIVE_CHILD_PROCESS_SEPARATION_FAILED'
  $timeout = & $writeFixture 'timeout.mjs' 'setTimeout(() => process.exit(0), 30000);'
  $timeoutResult = Invoke-R6NativeChildProcess -FileName $node -Arguments @($timeout) -WorkingDirectory $root -TimeoutMilliseconds 1000
  Require ($timeoutResult.ChildStarted -and $timeoutResult.ChildCompleted -and $timeoutResult.ChildTimedOut -and $timeoutResult.ChildExitCode -ne 0) 'R6_NATIVE_CHILD_PROCESS_TIMEOUT_FAILED'
  Write-Output 'R6_NATIVE_CHILD_PROCESS_OK stdout/stderr separation, localized value-blind classification, and timeout passed'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Module r6-native-child-process -Force -ErrorAction SilentlyContinue
}
