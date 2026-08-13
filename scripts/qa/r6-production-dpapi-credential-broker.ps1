Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:R6ProductionProjectRef = 'xcbnxzjlsvtgzixurcof'

function Get-R6ProductionPgPasswordSecureString {
  if ($env:OS -ne 'Windows_NT') { throw 'R6_DPAPI_CREDENTIAL_PROVIDER_WINDOWS_REQUIRED' }
  $root = Join-Path $env:LOCALAPPDATA 'OpenGlassHub\secrets'
  $path = Join-Path $root "supabase-$script:R6ProductionProjectRef-pgpassword.dpapi"
  $fullRoot = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  $fullPath = [IO.Path]::GetFullPath($path)
  if (-not $fullPath.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'R6_DPAPI_CREDENTIAL_PATH_INVALID' }
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { throw 'R6_DPAPI_CREDENTIAL_MISSING' }
  $item = Get-Item -LiteralPath $fullPath -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'R6_DPAPI_CREDENTIAL_REPARSE_FORBIDDEN' }
  try { return ConvertTo-SecureString -String ([IO.File]::ReadAllText($fullPath, [Text.Encoding]::UTF8)) -ErrorAction Stop }
  catch { throw 'R6_DPAPI_CREDENTIAL_DECRYPTION_FAILED' }
}
