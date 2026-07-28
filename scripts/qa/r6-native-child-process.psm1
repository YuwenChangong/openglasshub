Set-StrictMode -Version Latest

function Get-R6ChildClassification([string]$Text) {
  $matches = @([regex]::Matches($Text, '\bQA_CANARY_[A-Z0-9_]+\b') | ForEach-Object { $_.Value } | Where-Object { $_ -ne 'QA_CANARY_FAILED' } | Select-Object -Unique)
  if ($matches.Count -eq 1) { return [string]$matches[0] }
  return $null
}

function Invoke-R6NativeChildProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [ValidateRange(1000, 120000)][int]$TimeoutMilliseconds = 30000
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FileName
  $startInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-R6RestrictedNativeArgument ([string]$_) }) -join ' '
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $stdout = $null
  $stderr = $null
  try {
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'QA_CANARY_CHILD_START_FAILED' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutMilliseconds)
    if ($timedOut) {
      try { $process.Kill() } catch {}
      $process.WaitForExit()
    }
    [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 5000) | Out-Null
    $stdout = [string]$stdoutTask.Result
    $stderr = [string]$stderrTask.Result
    return [pscustomobject]@{
      ChildStarted = $true
      ChildCompleted = $true
      ChildExitCode = [int]$process.ExitCode
      ChildTimedOut = [bool]$timedOut
      StdoutClassification = Get-R6ChildClassification $stdout
      StderrClassification = Get-R6ChildClassification $stderr
      StdoutObserved = -not [string]::IsNullOrWhiteSpace($stdout)
      StderrObserved = -not [string]::IsNullOrWhiteSpace($stderr)
    }
  } finally {
    $stdout = $null
    $stderr = $null
    $process.Dispose()
  }
}

function ConvertTo-R6RestrictedNativeArgument([string]$Value) {
  if ($Value -match '[\x00\r\n]') { throw 'QA_CANARY_CHILD_ARGUMENT_INVALID' }
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

Export-ModuleMember -Function Invoke-R6NativeChildProcess
