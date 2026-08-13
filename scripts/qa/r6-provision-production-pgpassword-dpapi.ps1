[CmdletBinding(SupportsShouldProcess = $true)]
param([switch]$Rotate)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRef = 'xcbnxzjlsvtgzixurcof'
$SecretRoot = Join-Path $env:LOCALAPPDATA 'OpenGlassHub\secrets'
$SecretPath = Join-Path $SecretRoot "supabase-$ProjectRef-pgpassword.dpapi"

function Fail([string]$Code) { throw $Code }
function Assert-UnderSecretRoot([string]$Path) {
  $root = [IO.Path]::GetFullPath($SecretRoot).TrimEnd('\') + '\'
  $resolved = [IO.Path]::GetFullPath($Path)
  if (-not $resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { Fail 'R6_DPAPI_CREDENTIAL_PATH_INVALID' }
  return $resolved
}

if ($env:OS -ne 'Windows_NT') { Fail 'R6_DPAPI_CREDENTIAL_PROVIDER_WINDOWS_REQUIRED' }
$resolvedSecretPath = Assert-UnderSecretRoot $SecretPath
if (Test-Path -LiteralPath $resolvedSecretPath -PathType Leaf -and -not $Rotate) { Fail 'R6_DPAPI_CREDENTIAL_ALREADY_PROVISIONED' }
if (Test-Path -LiteralPath $resolvedSecretPath -PathType Container) { Fail 'R6_DPAPI_CREDENTIAL_PATH_INVALID' }
New-Item -ItemType Directory -Path $SecretRoot -Force | Out-Null
$directoryInfo = Get-Item -LiteralPath $SecretRoot -Force
if (($directoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Fail 'R6_DPAPI_CREDENTIAL_ROOT_REPARSE_FORBIDDEN' }

$secret = Read-Host 'Production database password (hidden)' -AsSecureString
try {
  $serialized = ConvertFrom-SecureString -SecureString $secret
  if ([string]::IsNullOrWhiteSpace($serialized)) { Fail 'R6_DPAPI_CREDENTIAL_SERIALIZATION_FAILED' }
  if ($PSCmdlet.ShouldProcess($resolvedSecretPath, 'Provision Windows DPAPI credential')) {
    $writePath = if ($Rotate) { "$resolvedSecretPath.rotate-$([Guid]::NewGuid().ToString('N'))" } else { $resolvedSecretPath }
    $stream = [IO.File]::Open($writePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $writer = New-Object IO.StreamWriter($stream, [Text.Encoding]::UTF8); try { $writer.Write($serialized); $writer.Flush() } finally { $writer.Dispose() } } finally { $stream.Dispose() }
    if ($Rotate) { [IO.File]::Replace($writePath, $resolvedSecretPath, $null) }
  }
} finally { $secret.Dispose() }

$fileInfo = Get-Item -LiteralPath $resolvedSecretPath -Force
if (($fileInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Remove-Item -LiteralPath $resolvedSecretPath -Force; Fail 'R6_DPAPI_CREDENTIAL_REPARSE_FORBIDDEN' }
& icacls.exe $resolvedSecretPath /inheritance:r /grant:r "$env:USERNAME:(R,W)" /grant:r 'SYSTEM:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'R6_DPAPI_CREDENTIAL_ACL_FAILED' }
Write-Output 'R6_DPAPI_CREDENTIAL_PROVISIONED=true'
