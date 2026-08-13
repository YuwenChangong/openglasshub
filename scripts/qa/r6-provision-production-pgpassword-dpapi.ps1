[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Rotate,
  [switch]$TestOnlyReachSecureInputBoundary,
  [switch]$TestOnlyAclHardening
)
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
function Get-R6CurrentUserSid {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ([string]::IsNullOrWhiteSpace($sid)) { Fail 'R6_DPAPI_CREDENTIAL_CURRENT_USER_SID_UNRESOLVED' }
  return $sid
}
function Get-R6IdentitySid([Security.Principal.IdentityReference]$IdentityReference) {
  return $IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
}
function Set-R6CredentialAcl([string]$Path) {
  $currentUserSid = Get-R6CurrentUserSid
  $currentUserGrant = "*$currentUserSid`:RW"
  $outputLines = @(& icacls.exe $Path '/inheritance:r' '/grant:r' $currentUserGrant '/grant:r' 'SYSTEM:F' 2>&1)
  $nativeExitCode = $LASTEXITCODE
  if ($nativeExitCode -ne 0) { Fail 'R6_DPAPI_CREDENTIAL_ACL_FAILED' }
  return $outputLines
}
function Assert-R6CredentialAclPolicy([string]$Path) {
  $currentUserSid = Get-R6CurrentUserSid
  $systemSid = 'S-1-5-18'
  $broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
  $rules = @(Get-Acl -LiteralPath $Path | Select-Object -ExpandProperty Access)
  $allowRules = @($rules | Where-Object { $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow })
  foreach ($rule in $allowRules) {
    $sid = Get-R6IdentitySid $rule.IdentityReference
    if ($sid -in $broadSids -or $sid -notin @($currentUserSid, $systemSid)) { Fail 'R6_DPAPI_CREDENTIAL_ACL_POLICY_INVALID' }
  }
  $userRights = [int](($allowRules | Where-Object { (Get-R6IdentitySid $_.IdentityReference) -eq $currentUserSid } | ForEach-Object { [int]$_.FileSystemRights } | Measure-Object -Sum).Sum)
  $systemRights = [int](($allowRules | Where-Object { (Get-R6IdentitySid $_.IdentityReference) -eq $systemSid } | ForEach-Object { [int]$_.FileSystemRights } | Measure-Object -Sum).Sum)
  if (($userRights -band [int][Security.AccessControl.FileSystemRights]::ReadData) -eq 0 -or ($userRights -band [int][Security.AccessControl.FileSystemRights]::WriteData) -eq 0) { Fail 'R6_DPAPI_CREDENTIAL_ACL_POLICY_INVALID' }
  if (($userRights -band [int][Security.AccessControl.FileSystemRights]::FullControl) -eq [int][Security.AccessControl.FileSystemRights]::FullControl) { Fail 'R6_DPAPI_CREDENTIAL_ACL_POLICY_INVALID' }
  if (($systemRights -band [int][Security.AccessControl.FileSystemRights]::FullControl) -ne [int][Security.AccessControl.FileSystemRights]::FullControl) { Fail 'R6_DPAPI_CREDENTIAL_ACL_POLICY_INVALID' }
}
function Invoke-R6SyntheticAclHardeningTest {
  $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("r6-dpapi-acl-" + [Guid]::NewGuid().ToString('N'))
  $temporaryPath = Join-Path $temporaryRoot 'synthetic-credential.dpapi'
  try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    [IO.File]::WriteAllText($temporaryPath, 'synthetic-acl-regression', [Text.Encoding]::UTF8)
    [void](Set-R6CredentialAcl $temporaryPath)
    Assert-R6CredentialAclPolicy $temporaryPath
    Write-Output 'SYNTHETIC_ACL_COMMAND_EXIT=0'
    Write-Output 'SYNTHETIC_ACL_POLICY=PASS'
    Write-Output 'DPAPI_ACL_PERMISSION_MASK_REGRESSION=PASS'
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
  }
}

if ($env:OS -ne 'Windows_NT') { Fail 'R6_DPAPI_CREDENTIAL_PROVIDER_WINDOWS_REQUIRED' }
$resolvedSecretPath = Assert-UnderSecretRoot $SecretPath
if ($TestOnlyAclHardening) { Invoke-R6SyntheticAclHardeningTest; exit 0 }
if ($TestOnlyReachSecureInputBoundary) { Write-Output 'R6_DPAPI_PROVISIONING_SECURE_INPUT_BOUNDARY_REACHED'; exit 0 }
if ((Test-Path -LiteralPath $resolvedSecretPath -PathType Leaf) -and -not $Rotate) { Fail 'R6_DPAPI_CREDENTIAL_ALREADY_PROVISIONED' }
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
[void](Set-R6CredentialAcl $resolvedSecretPath)
Write-Output 'R6_DPAPI_CREDENTIAL_PROVISIONED=true'
