Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }
function Expect-Failure([scriptblock]$Action, [string]$Expected) {
  try { & $Action; throw "R6_FINAL_EXECUTION_BINDING_EXPECTED_FAILURE_MISSING:$Expected" }
  catch { Require ($_.Exception.Message -match [regex]::Escape($Expected)) "R6_FINAL_EXECUTION_BINDING_FAILURE_MISMATCH:${Expected}:$($_.Exception.Message)" }
}

$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'qa\r6-detached-secure-wrapper.ps1'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('r6-final-binding-' + [guid]::NewGuid().ToString())
$evidence = Join-Path ([IO.Path]::GetTempPath()) ('r6-final-binding-evidence-' + [guid]::NewGuid().ToString())
$oldLibraryMode = $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE
try {
  New-Item -ItemType Directory -Path (Join-Path $temporary 'scripts\qa') -Force | Out-Null
  foreach ($relative in @('scripts\qa\r6-detached-secure-wrapper.ps1', 'scripts\qa\canonical-canary-target-binding.mjs', 'scripts\qa\r6-final-execution-binding.mjs', 'scripts\qa\validate-r6-final-execution-binding.mjs', 'scripts\qa\r6-final-canary-execution-contract.mjs', 'scripts\qa\run-production-minimal-canary.mjs', 'scripts\qa\run-r6-final-canary-read-only-postflight.mjs')) {
    $destination = Join-Path $temporary $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo $relative) -Destination $destination -Force
  }
  & git -C $temporary init -q
  & git -C $temporary config user.email 'r6-fixture@example.invalid'
  & git -C $temporary config user.name 'R6 fixture'
  & git -C $temporary add scripts
  & git -C $temporary commit -qm 'fixture'
  $head = (& git -C $temporary rev-parse HEAD).Trim()
  & git -C $temporary checkout --detach -q $head
  $wrapper = Join-Path $temporary 'scripts\qa\r6-detached-secure-wrapper.ps1'
  $authorizationPath = Join-Path $evidence 'authorization.json'; $receiptPath = Join-Path $evidence 'receipt.json'; $bindingPath = Join-Path $evidence 'final-execution-binding.json'
  New-Item -ItemType Directory -Path $evidence -Force | Out-Null
  $dryRunId = 'qa-canary-11111111-1111-4111-8111-111111111111'
  $plan = [ordered]@{ schemaVersion='qa-minimal-canary-mutation-plan-v2'; planSha256=('a' * 64) }
  $targetBindingModule = Join-Path $temporary 'scripts\qa\canonical-canary-target-binding.mjs'
  $targetBindingOutput = @(& node --input-type=module -e "import { pathToFileURL } from 'node:url'; const { createCanonicalCanaryTargetBinding } = await import(pathToFileURL(process.argv[1]).href); process.stdout.write(JSON.stringify(createCanonicalCanaryTargetBinding({ resolvedAtUtc: '2026-07-29T00:00:00.000Z', canonicalCircleId: '22222222-2222-4222-8222-222222222222', canonicalCircleSlug: 'synthetic-canonical-circle', baseMutationPlanSchema: process.argv[2], baseMutationPlanHash: process.argv[3], executionCommit: process.argv[4], toolingCommit: process.argv[4] })));" $targetBindingModule $plan.schemaVersion $plan.planSha256 $head 2>&1)
  Require ($LASTEXITCODE -eq 0 -and $targetBindingOutput.Count -eq 1) 'R6_FINAL_EXECUTION_BINDING_TARGET_FIXTURE_FAILED'
  $targetBinding = $targetBindingOutput[0].ToString() | ConvertFrom-Json
  [IO.File]::WriteAllText($authorizationPath, (([ordered]@{ dryRunRunId=$dryRunId; executionCommit=$head; toolingCommit=$head; plan=$plan; plannedMutationCount=2; actualMutationCount=0 } | ConvertTo-Json -Compress) + "`n") , [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($receiptPath, (([ordered]@{ state='CONSUMED'; runId=$dryRunId; runnerCommit=$head } | ConvertTo-Json -Compress) + "`n") , [Text.UTF8Encoding]::new($false))
  $blob = { param([string]$relative) (& git -C $temporary rev-parse "HEAD:$relative").Trim() }
  $binding = [ordered]@{
    schemaVersion='r6-final-execution-binding-v2'; executionWorktree=$temporary; executionCommit=$head; runnerCommit=$head; toolingCommit=$head
    wrapperPath=$wrapper; wrapperSha256=(Get-FileHash $wrapper -Algorithm SHA256).Hash.ToLowerInvariant()
    finalContractGitBlob=(& $blob 'scripts/qa/r6-final-canary-execution-contract.mjs'); executeRunnerGitBlob=(& $blob 'scripts/qa/run-production-minimal-canary.mjs'); postflightRunnerGitBlob=(& $blob 'scripts/qa/run-r6-final-canary-read-only-postflight.mjs'); bindingValidatorGitBlob=(& $blob 'scripts/qa/validate-r6-final-execution-binding.mjs'); bindingLibraryGitBlob=(& $blob 'scripts/qa/r6-final-execution-binding.mjs')
    parentAuthorizationPath=$authorizationPath; parentAuthorizationSha256=(Get-FileHash $authorizationPath -Algorithm SHA256).Hash.ToLowerInvariant(); parentReceiptPath=$receiptPath; parentReceiptSha256=(Get-FileHash $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant(); parentDryRunRunId=$dryRunId
    planSchema='qa-minimal-canary-mutation-plan-v2'; planSha256=('a' * 64); targetBinding=$targetBinding; approvedOperationIds=@('CREATE_POST','CREATE_COMMENT'); plannedMutationCount=2; parentActualMutationCount=0
  }
  [IO.File]::WriteAllText($bindingPath, (($binding | ConvertTo-Json -Depth 4 -Compress) + "`n"), [Text.UTF8Encoding]::new($false))
  $bindingSha = (Get-FileHash $bindingPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = '1'
  . $wrapper -ExecutionWorktree $temporary
  Resolve-R6GitExecutable
  $validated = Get-FinalExecutionBinding $bindingPath $bindingSha $temporary
  $result = Assert-FinalExecutionWorktree $temporary $validated 'qa-canary-22222222-2222-4222-8222-222222222222'
  Require ($result.Head -eq $head -and $result.Detached) 'R6_FINAL_EXECUTION_BINDING_SUCCESS_CONTRACT_FAILED'
  Expect-Failure { Assert-FinalExecutionWorktree $temporary ([pscustomobject]@{}) 'qa-canary-22222222-2222-4222-8222-222222222222' } 'R6_FINAL_LOCAL_BINDING_REQUIRED'
  $wrongPath = $validated | Select-Object *; $wrongPath.executionWorktree = $evidence
  Expect-Failure { Assert-FinalExecutionWorktree $temporary $wrongPath 'qa-canary-22222222-2222-4222-8222-222222222222' } 'R6_FINAL_EXECUTION_WORKTREE_PATH_REJECTED'
  $wrongCommit = $validated | Select-Object *; $wrongCommit.runnerCommit = ('0' * 40)
  Expect-Failure { Assert-FinalExecutionWorktree $temporary $wrongCommit 'qa-canary-22222222-2222-4222-8222-222222222222' } 'R6_FINAL_EXECUTION_COMMIT_MISMATCH'
  New-Item -ItemType Directory -Path (Join-Path $temporary 'node_modules') | Out-Null
  Expect-Failure { Assert-FinalExecutionWorktree $temporary $validated 'qa-canary-22222222-2222-4222-8222-222222222222' } 'R6_FINAL_EXECUTION_NODE_MODULES_PRESENT'
  Remove-Item -LiteralPath (Join-Path $temporary 'node_modules') -Force
  [IO.File]::WriteAllText((Join-Path $temporary 'dirty.txt'), 'x', [Text.UTF8Encoding]::new($false))
  Expect-Failure { Assert-FinalExecutionWorktree $temporary $validated 'qa-canary-22222222-2222-4222-8222-222222222222' } 'R6_FINAL_EXECUTION_WORKTREE_DIRTY'
  Write-Output 'R6_FINAL_EXECUTION_WORKTREE_BINDING_TEST_OK'
} finally {
  $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = $oldLibraryMode
  Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $evidence -Recurse -Force -ErrorAction SilentlyContinue
}
