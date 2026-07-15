Set-StrictMode -Version Latest

function Assert-NativeExitCode {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][int]$ExitCode
  )
  if ($ExitCode -ne 0) { throw "Stop: $CommandName failed with exit code $ExitCode." }
}

function Invoke-RequiredNativeLines {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $lines = @(& $CommandName @Arguments)
  $exitCode = $LASTEXITCODE
  Assert-NativeExitCode -CommandName $CommandName -ExitCode $exitCode
  return @($lines)
}

function Assert-WorktreeClean {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$StatusLines)
  if ($StatusLines.Count -ne 0) {
    $renderedStatus = [string]::Join([Environment]::NewLine, [string[]]$StatusLines)
    throw "Stop: worktree is not clean.`n$renderedStatus"
  }
}

function Get-ExactlyOneNativeLine {
  param(
    [Parameter(Mandatory = $true)][string]$CommandName,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$OutputLines
  )
  if ($OutputLines.Count -ne 1) { throw "Stop: $CommandName returned $($OutputLines.Count) output lines; expected exactly one." }
  return ([string]$OutputLines[0]).Trim()
}

function Assert-ExpectedGitRefs {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedHead,
    [Parameter(Mandatory = $true)][string]$Head,
    [Parameter(Mandatory = $true)][string]$OriginHead
  )
  if ($Head -ne $ExpectedHead -or $OriginHead -ne $ExpectedHead) { throw "Stop: expected HEAD/origin $ExpectedHead; found HEAD $Head and origin $OriginHead." }
}

function Invoke-OnlyAfterPreflight {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Preflight,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  & $Preflight
  & $Action
}
