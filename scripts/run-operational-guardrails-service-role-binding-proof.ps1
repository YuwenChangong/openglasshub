[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet("preview", "production")][string]$Environment,
  [Parameter(Mandatory = $true)][ValidateSet("SECRET_BINDING_PRESENT", "BINDING_ABSENT", "PLAINTEXT_BINDING_PRESENT", "CONFLICTING_BINDINGS_PRESENT", "BROWSER_EXPOSURE_CONFLICT", "INSUFFICIENT_EVIDENCE")][string]$Classification,
  [Parameter(Mandatory = $true)][ValidatePattern("^[0-9a-fA-F]{40}$")][string]$SourceCommit,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$writer = Join-Path $root "scripts\write-operational-guardrails-service-role-binding-proof.mjs"
$validator = Join-Path $root "scripts\validate-operational-guardrails-service-role-binding-proof.mjs"

& node $writer --environment $Environment --classification $Classification --source-commit $SourceCommit --output $OutputPath
if ($LASTEXITCODE -ne 0) {
  throw "Proof writer failed. The validator was not invoked and no proof result is accepted."
}

$validatorOutput = @(& node $validator $OutputPath)
$validatorExit = $LASTEXITCODE
$validatorOutput | Write-Output
if ($validatorExit -ne 0) {
  Write-Output "Proof preserved with valid fail-closed classification $Classification. No Cloudflare mutation was performed."
  $global:LASTEXITCODE = $validatorExit
  return
}

$global:LASTEXITCODE = 0
