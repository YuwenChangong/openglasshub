$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$provisioner = Join-Path $PSScriptRoot 'qa\r6-provision-production-pgpassword-dpapi.ps1'
$source = [IO.File]::ReadAllText($provisioner)
if ($source -match 'Test-Path\s+-LiteralPath\s+\$resolvedSecretPath\s+-PathType\s+Leaf\s+-and') { throw 'R6_DPAPI_PROVISIONING_PARAMETER_BINDING_REGRESSION_FAILED' }
[void][scriptblock]::Create($source)

$existing = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($existing)) { throw 'R6_DPAPI_PROVISIONING_LOCALAPPDATA_REQUIRED' }
$secretPath = Join-Path $existing 'OpenGlassHub\secrets\supabase-xcbnxzjlsvtgzixurcof-pgpassword.dpapi'
if (Test-Path -LiteralPath $secretPath -PathType Leaf) { throw 'R6_DPAPI_PROVISIONING_TEST_REQUIRES_ABSENT_REAL_BLOB' }

$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $provisioner -TestOnlyReachSecureInputBoundary 2>&1
if ($LASTEXITCODE -ne 0 -or -not (($result | Out-String) -match 'R6_DPAPI_PROVISIONING_SECURE_INPUT_BOUNDARY_REACHED')) { throw 'R6_DPAPI_PROVISIONING_TEST_SECURE_INPUT_BOUNDARY_UNREACHED' }
if (($result | Out-String) -match 'NamedParameterNotFound|parameter name .and.') { throw 'R6_DPAPI_PROVISIONING_PARAMETER_BINDING_REGRESSION_FAILED' }
if (Test-Path -LiteralPath $secretPath -PathType Leaf) { throw 'R6_DPAPI_PROVISIONING_TEST_REAL_BLOB_CREATED' }
Write-Output 'R6_DPAPI_PROVISIONING_ENTRYPOINT_PARAMETER_BINDING_REGRESSION_PASS'
