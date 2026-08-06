[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$IssuerConfigPath,
  [Parameter(Mandatory=$true)][string]$LauncherPath,
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [Parameter(Mandatory=$true)][string]$AttestationPath,
  [Parameter(Mandatory=$true)][string]$Node22Path,
  [Parameter(Mandatory=$true)][string]$WranglerEntryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$script:ParentStart=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$script:AtomicSessionId=[guid]::NewGuid().ToString()
$nonceBytes=New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($nonceBytes)
$script:HandoffNonce=(-join($nonceBytes|ForEach-Object{$_.ToString('x2')}))

function Invoke-ReadinessAttestation([string]$ConfigPath) {
  $lines=@($script:HandoffNonce | & $Node22Path (Join-Path $PSScriptRoot 'issue-r6-v3-oauth-readiness-attestation.mjs') --config $ConfigPath --handoff-nonce-stdin 2>&1)
  $exit=$LASTEXITCODE
  if($exit -eq 0 -and $lines.Count -eq 1){return ($lines[0]|ConvertFrom-Json)}
  $code=($lines|Select-Object -Last 1).ToString().Trim()
  if($code -notmatch '^R6_[A-Z0-9_]+$'){$code='R6_OAUTH_READINESS_ATTESTATION_FAILED'}
  throw $code
}

try {
  $issuerConfig=Get-Content -LiteralPath $IssuerConfigPath -Raw|ConvertFrom-Json
  $readinessConfig=[ordered]@{attestationPath=$AttestationPath;attestationRoot=(Split-Path -Parent $AttestationPath);executionCommit=$issuerConfig.executionCommit;branch=$issuerConfig.branch;wrapperSha256=$issuerConfig.wrapperSha256;wranglerVersion=$issuerConfig.wranglerVersion;wranglerEntrySha256=$issuerConfig.wranglerEntrySha256;atomicSessionId=$script:AtomicSessionId;parentPowerShellPid=$PID;parentPowerShellStartTime=$script:ParentStart}
  $temporary=Join-Path ([IO.Path]::GetTempPath()) ('r6-oauth-readiness-'+[guid]::NewGuid().ToString()+'.json')
  try {
    [IO.File]::WriteAllText($temporary,($readinessConfig|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
    try {$envelope=Invoke-ReadinessAttestation $temporary}
    catch {
      if($_.Exception.Message -notin @('R6_OAUTH_PROFILE_REFRESH_REQUIRED','R6_OAUTH_LOGIN_REQUIRED')){throw}
      & $Node22Path $WranglerEntryPath login --browser true --scopes pages:write
      if($LASTEXITCODE -ne 0){throw 'R6_OAUTH_LOGIN_FAILED'}
      $envelope=Invoke-ReadinessAttestation $temporary
    }
    $issuerConfig|Add-Member -NotePropertyName attestationPath -NotePropertyValue $envelope.attestationPath -Force
    $issuerConfig|Add-Member -NotePropertyName attestationRoot -NotePropertyValue $readinessConfig.attestationRoot -Force
    $issuerConfig|Add-Member -NotePropertyName expectedAttestationSha256 -NotePropertyValue $envelope.attestationSha256 -Force
    $issuerConfig|Add-Member -NotePropertyName atomicSessionId -NotePropertyValue $script:AtomicSessionId -Force
    $issuerConfig|Add-Member -NotePropertyName parentPowerShellPid -NotePropertyValue $PID -Force
    $issuerConfig|Add-Member -NotePropertyName parentPowerShellStartTime -NotePropertyValue $script:ParentStart -Force
    $issuerTemp=Join-Path ([IO.Path]::GetTempPath()) ('r6-dryrun-issuer-'+[guid]::NewGuid().ToString()+'.json')
    try {
      [IO.File]::WriteAllText($issuerTemp,($issuerConfig|ConvertTo-Json -Depth 8 -Compress),[Text.UTF8Encoding]::new($false))
      $script:HandoffNonce | & $Node22Path (Join-Path $PSScriptRoot 'issue-r6-v3-operator-dryrun-package.mjs') --config $issuerTemp --launcher $LauncherPath --manifest $ManifestPath --handoff-nonce-stdin
      if($LASTEXITCODE -ne 0){throw 'R6_ATOMIC_DRYRUN_ISSUER_FAILED'}
    } finally {[IO.File]::Delete($issuerTemp)}
  } finally {[IO.File]::Delete($temporary)}
} finally {
  [Array]::Clear($nonceBytes,0,$nonceBytes.Length);$script:HandoffNonce=$null
}
