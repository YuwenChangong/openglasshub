$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$provisioner = Join-Path $PSScriptRoot 'qa\r6-provision-production-pgpassword-dpapi.ps1'
$source = [IO.File]::ReadAllText($provisioner)
if ($source -match 'Test-Path\s+-LiteralPath\s+\$resolvedSecretPath\s+-PathType\s+Leaf\s+-and') { throw 'R6_DPAPI_PROVISIONING_PARAMETER_BINDING_REGRESSION_FAILED' }
if ($source -match '\(R,W\)') { throw 'R6_DPAPI_ACL_PERMISSION_MASK_REGRESSION_FAILED' }
if ($source -notmatch '\*\$currentUserSid`:RW') { throw 'R6_DPAPI_ACL_PERMISSION_MASK_REGRESSION_FAILED' }
[void][scriptblock]::Create($source)

$existing = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($existing)) { throw 'R6_DPAPI_PROVISIONING_LOCALAPPDATA_REQUIRED' }
$secretPath = Join-Path $existing 'OpenGlassHub\secrets\supabase-xcbnxzjlsvtgzixurcof-pgpassword.dpapi'
$realBlobInitialState = Test-Path -LiteralPath $secretPath -PathType Leaf
if ($source -notmatch 'Test-Path\s+-LiteralPath\s+\$resolvedSecretPath\s+-PathType\s+Leaf\)\s+-and\s+-not\s+\$Rotate') { throw 'R6_DPAPI_PROVISIONING_NO_CLOBBER_GUARD_MISSING' }

$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $provisioner -TestOnlyReachSecureInputBoundary 2>&1
if ($LASTEXITCODE -ne 0 -or -not (($result | Out-String) -match 'R6_DPAPI_PROVISIONING_SECURE_INPUT_BOUNDARY_REACHED')) { throw 'R6_DPAPI_PROVISIONING_TEST_SECURE_INPUT_BOUNDARY_UNREACHED' }
if (($result | Out-String) -match 'NamedParameterNotFound|parameter name .and.') { throw 'R6_DPAPI_PROVISIONING_PARAMETER_BINDING_REGRESSION_FAILED' }
if ((Test-Path -LiteralPath $secretPath -PathType Leaf) -ne $realBlobInitialState) { throw 'R6_DPAPI_PROVISIONING_TEST_REAL_BLOB_STATE_CHANGED' }
$aclResult = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $provisioner -TestOnlyAclHardening 2>&1
if ($LASTEXITCODE -ne 0 -or -not (($aclResult | Out-String) -match 'SYNTHETIC_ACL_COMMAND_EXIT=0') -or -not (($aclResult | Out-String) -match 'SYNTHETIC_ACL_POLICY=PASS') -or -not (($aclResult | Out-String) -match 'DPAPI_ACL_PERMISSION_MASK_REGRESSION=PASS')) { throw 'R6_DPAPI_ACL_SYNTHETIC_REGRESSION_FAILED' }
if (($aclResult | Out-String) -match 'Invalid parameter "\(R,W\)"|无效参数 "\(R,W\)"') { throw 'R6_DPAPI_ACL_PERMISSION_MASK_REGRESSION_FAILED' }
if ((Test-Path -LiteralPath $secretPath -PathType Leaf) -ne $realBlobInitialState) { throw 'R6_DPAPI_PROVISIONING_TEST_REAL_BLOB_STATE_CHANGED' }
if ($realBlobInitialState) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $noClobberResult = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $provisioner 2>&1
    $noClobberExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($noClobberExitCode -eq 0 -or -not (($noClobberResult | Out-String) -match 'R6_DPAPI_CREDENTIAL_ALREADY_PROVISIONED')) { throw 'R6_DPAPI_PROVISIONING_NO_CLOBBER_RUNTIME_FAILED' }
  if ((Test-Path -LiteralPath $secretPath -PathType Leaf) -ne $realBlobInitialState) { throw 'R6_DPAPI_PROVISIONING_TEST_REAL_BLOB_STATE_CHANGED' }
}
Write-Output 'R6_DPAPI_PROVISIONING_ENTRYPOINT_PARAMETER_BINDING_REGRESSION_PASS'
Write-Output 'R6_DPAPI_ACL_PERMISSION_MASK_REGRESSION_PASS'
Write-Output 'R6_DPAPI_ACL_SYNTHETIC_POLICY_PASS'
Write-Output 'R6_DPAPI_PROVISIONING_NO_CLOBBER_PASS'
