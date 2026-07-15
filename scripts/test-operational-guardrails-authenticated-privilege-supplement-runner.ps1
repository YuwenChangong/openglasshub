$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "lib\operational-guardrails-authenticated-privilege-runner.ps1")

function Assert-Throws {
  param([Parameter(Mandatory = $true)][scriptblock]$Action, [Parameter(Mandatory = $true)][string]$Pattern)
  try { & $Action } catch {
    if ($_.Exception.Message -notmatch $Pattern) { throw "Unexpected error: $($_.Exception.Message)" }
    return
  }
  throw "Expected failure matching: $Pattern"
}

Assert-WorktreeClean -StatusLines @()
Assert-Throws -Action { Assert-WorktreeClean -StatusLines @('?? "one odd name"') } -Pattern 'one odd name'
Assert-Throws -Action { Assert-WorktreeClean -StatusLines @(' M one', '?? two') } -Pattern ' M one'
Assert-Throws -Action { Assert-NativeExitCode -CommandName git -ExitCode 2 } -Pattern 'git failed with exit code 2'
if ((Get-ExactlyOneNativeLine -CommandName git -OutputLines @('abc')) -ne 'abc') { throw 'single native output line handling failed' }
Assert-Throws -Action { Get-ExactlyOneNativeLine -CommandName git -OutputLines @() } -Pattern 'returned 0 output lines'
Assert-Throws -Action { Get-ExactlyOneNativeLine -CommandName git -OutputLines @('a', 'b') } -Pattern 'returned 2 output lines'
Assert-ExpectedGitRefs -ExpectedHead ('a' * 40) -Head ('a' * 40) -OriginHead ('a' * 40)
Assert-Throws -Action { Assert-ExpectedGitRefs -ExpectedHead ('a' * 40) -Head ('b' * 40) -OriginHead ('a' * 40) } -Pattern 'expected HEAD/origin'

$databaseActionCalled = $false
Assert-Throws -Action {
  Invoke-OnlyAfterPreflight -Preflight { throw 'preflight failed' } -Action { $script:databaseActionCalled = $true }
} -Pattern 'preflight failed'
if ($databaseActionCalled) { throw 'database action ran after a failed preflight' }

Write-Output 'operational-guardrails authenticated privilege strict-mode runner tests: PASS'
