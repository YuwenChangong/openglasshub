[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require([bool]$Condition, [string]$Code) {
  if (-not $Condition) { throw $Code }
}

function ConvertTo-RestrictedNativeArgument([string]$Value) {
  if ($null -eq $Value -or $Value -match '["\r\n]') { throw 'R6_V3_STDIN_TRANSPORT_ARGUMENT_UNSAFE' }
  return '"' + $Value + '"'
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('r6-v3-stdin-transport-' + [guid]::NewGuid().ToString())
try {
  New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
  $child = Join-Path $root 'stdin-probe.mjs'
  [IO.File]::WriteAllText($child, @'
const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const raw = Buffer.concat(chunks);
try {
  if (process.stdin.isTTY || raw.toString("utf8") !== `${"a".repeat(32)}\n`) process.exitCode = 1;
  else process.stdout.write("R6_V3_WRAPPER_STDIN_TRANSPORT_OK\n");
} finally { raw.fill(0); }
'@, [Text.Encoding]::UTF8)

  $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $node
  $startInfo.Arguments = (ConvertTo-RestrictedNativeArgument $child)
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $process = New-Object System.Diagnostics.Process
  try {
    $process.StartInfo = $startInfo
    Require $process.Start() 'R6_V3_STDIN_TRANSPORT_PROCESS_START_FAILED'
    $process.StandardInput.Write(('a' * 32))
    $process.StandardInput.Write("`n")
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    Require ($process.ExitCode -eq 0) 'R6_V3_STDIN_TRANSPORT_PROCESS_FAILED'
    Require ($stdout -eq "R6_V3_WRAPPER_STDIN_TRANSPORT_OK`n") 'R6_V3_STDIN_TRANSPORT_OUTPUT_INVALID'
    Require ([string]::IsNullOrEmpty($stderr)) 'R6_V3_STDIN_TRANSPORT_STDERR_INVALID'
  } finally {
    $process.Dispose()
  }
  Write-Output 'R6_V3_WRAPPER_STDIN_TRANSPORT_OK hidden PowerShell input bridge passes only an exact one-line value through redirected stdin with no network'
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
