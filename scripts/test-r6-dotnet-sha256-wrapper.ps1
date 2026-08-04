[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ExecutionWorktree,
  [Parameter(Mandatory = $true)][string]$WrapperPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require([bool]$Condition, [string]$Code) { if (-not $Condition) { throw $Code } }

function Get-NodeSha256([string]$Path) {
  $program = "const fs=require('fs'),crypto=require('crypto');const h=crypto.createHash('sha256');const s=fs.createReadStream(process.argv[1]);s.on('data',c=>h.update(c));s.on('end',()=>process.stdout.write(h.digest('hex')));s.on('error',()=>process.exit(2));"
  $output = @(& node -e $program $Path 2>&1)
  Require ($LASTEXITCODE -eq 0 -and $output.Count -eq 1 -and $output[0].ToString() -match '^[a-f0-9]{64}$') 'R6_DOTNET_SHA256_NODE_REFERENCE_FAILED'
  return $output[0].ToString()
}

function Assert-HashMatchesReference([string]$Path) {
  $actual = Get-Sha256 $Path
  $expected = Get-NodeSha256 $Path
  Require ($actual -is [string] -and $actual -match '^[a-f0-9]{64}$' -and $actual -eq $expected) 'R6_DOTNET_SHA256_REFERENCE_MISMATCH'
}

function Invoke-ExternalPreCaptureFixture([string]$Kind) {
  $evidenceBase = 'C:\Users\1\OpenGlassHub-R6-Proof\r6-current-canonical-production-v3-evidence'
  $evidenceRoot = Join-Path $evidenceBase ('test-r6-dotnet-sha256-' + $Kind + '-' + [guid]::NewGuid().ToString())
  $childScript = Join-Path ([IO.Path]::GetTempPath()) ('r6-dotnet-sha256-child-' + [guid]::NewGuid().ToString() + '.ps1')
  $runId = 'qa-canary-00000000-0000-4000-8000-000000000098'
  $child = @'
param([string]$WrapperPath,[string]$ExecutionWorktree,[string]$EvidenceRoot,[string]$Kind,[string]$RunId)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$env:R6_CURRENT_CANONICAL_V3_WRAPPER_TEST_MODE='1'
$env:R6_DETACHED_TRANSPORT_LIBRARY_MODE=$null
$script:shadowCalls=0
if($Kind -eq 'function') { function global:Get-FileHash { $script:shadowCalls++; throw 'shadowed' } }
if($Kind -eq 'alias') { function global:Invoke-SyntheticHashShadow { $script:shadowCalls++; throw 'shadowed' }; Set-Alias -Name Get-FileHash -Value Invoke-SyntheticHashShadow -Scope Global }
$PSModuleAutoloadingPreference='None'
$missing=$false
if($Kind -eq 'none') { try { Get-Command -Name Get-FileHash -ErrorAction Stop | Out-Null } catch { $missing=$true } }
try { & $WrapperPath -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly -RunId $RunId -EvidenceRoot $EvidenceRoot -R6PreCaptureTestStop }
catch { [Console]::WriteLine('classification=' + [string]$_.Exception.Message) }
[Console]::WriteLine('getFileHashUnresolved=' + $missing)
[Console]::WriteLine('shadowCalls=' + $script:shadowCalls)
'@
  try {
    [IO.File]::WriteAllText($childScript, $child, [Text.UTF8Encoding]::new($false))
    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $childScript $WrapperPath $ExecutionWorktree $evidenceRoot $Kind $runId 2>&1)
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    Require ($text -match 'classification=R6_CURRENT_CANONICAL_V3_PRE_CAPTURE_TEST_STOPPED') 'R6_DOTNET_SHA256_PRE_CAPTURE_FIXTURE_FAILED'
    if ($Kind -eq 'none') { Require ($text -match 'getFileHashUnresolved=True') 'R6_DOTNET_SHA256_AUTOLOAD_DISABLED_NOT_PROVEN' }
    if ($Kind -in @('function','alias')) { Require ($text -match 'shadowCalls=0') 'R6_DOTNET_SHA256_GET_FILE_HASH_SHADOW_CALLED' }
    Require (Test-Path -LiteralPath $evidenceRoot -PathType Container) 'R6_DOTNET_SHA256_EVIDENCE_PRECONDITION_NOT_REACHED'
    Require (-not (Test-Path -LiteralPath (Join-Path $evidenceRoot 'current-canonical-production-v3-metadata-preparation-terminal-result.json'))) 'R6_DOTNET_SHA256_CAPTURE_STARTED'
  } finally {
    if (Test-Path -LiteralPath $childScript) { Remove-Item -LiteralPath $childScript -Force }
    if (Test-Path -LiteralPath $evidenceRoot) { Remove-Item -LiteralPath $evidenceRoot -Recurse -Force }
  }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('r6-dotnet-sha256-' + [guid]::NewGuid().ToString())
$oldLibraryMode = $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE
try {
  $wrapperText = Get-Content -LiteralPath $WrapperPath -Raw
  Require ($wrapperText -notmatch '(?i)Get-FileHash|Microsoft\.PowerShell\.Utility\\Get-FileHash|Import-Module\s+Microsoft\.PowerShell\.Utility|PSModuleAutoloadingPreference') 'R6_DOTNET_SHA256_MODULE_DEPENDENCY_REMAINS'

  $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = '1'
  . $WrapperPath -ExecutionWorktree $ExecutionWorktree -PrepareCurrentCanonicalProductionV3AuthCheckAndDryRunOnly -RunId 'qa-canary-00000000-0000-4000-8000-000000000098' -EvidenceRoot (Join-Path $root 'inert-evidence')

  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $files = @{
    'empty.bin' = [byte[]]@()
    'ascii.txt' = [Text.Encoding]::ASCII.GetBytes('OpenGlass-Hub-R6')
    'utf8.bin' = [byte[]](0xEF,0xBB,0xBF,0xCE,0xB1,0xE2,0x82,0xAC)
    'binary.bin' = [byte[]](0,1,2,3,255,254,128,127)
    'large.bin' = [byte[]]::new(131073)
    'path with spaces.bin' = [byte[]](0x52,0x36,0x20,0x68,0x61,0x73,0x68)
    'readonly.bin' = [byte[]](0x72,0x65,0x61,0x64,0x6F,0x6E,0x6C,0x79)
  }
  for ($index = 0; $index -lt $files['large.bin'].Length; $index++) { $files['large.bin'][$index] = [byte]($index % 251) }
  foreach ($name in $files.Keys) { [IO.File]::WriteAllBytes((Join-Path $root $name), $files[$name]) }
  [IO.File]::SetAttributes((Join-Path $root 'readonly.bin'), [IO.FileAttributes]::ReadOnly)
  foreach ($name in $files.Keys) { Assert-HashMatchesReference (Join-Path $root $name) }

  foreach ($case in @(@((Join-Path $root 'missing.bin'), 'R6_DETACHED_WRAPPER_HASH_INPUT_FILE_NOT_FOUND'), @($root, 'R6_DETACHED_WRAPPER_HASH_INPUT_FILE_NOT_FOUND'))) {
    try { $null = Get-Sha256 $case[0]; throw 'R6_DOTNET_SHA256_EXPECTED_FAILURE_NOT_RAISED' } catch { Require ($_.Exception.Message -eq $case[1]) 'R6_DOTNET_SHA256_FAILURE_CLASSIFICATION_INVALID' }
  }

  Invoke-ExternalPreCaptureFixture 'none'
  Invoke-ExternalPreCaptureFixture 'function'
  Invoke-ExternalPreCaptureFixture 'alias'
  Write-Output 'R6_DOTNET_SHA256_WRAPPER_FIXTURE_OK'
} finally {
  if (Test-Path -LiteralPath (Join-Path $root 'readonly.bin')) { [IO.File]::SetAttributes((Join-Path $root 'readonly.bin'), [IO.FileAttributes]::Normal) }
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
  if ($null -eq $oldLibraryMode) { Remove-Item Env:R6_DETACHED_TRANSPORT_LIBRARY_MODE -ErrorAction SilentlyContinue } else { $env:R6_DETACHED_TRANSPORT_LIBRARY_MODE = $oldLibraryMode }
}
