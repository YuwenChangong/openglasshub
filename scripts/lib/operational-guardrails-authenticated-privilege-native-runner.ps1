Set-StrictMode -Version Latest

function Assert-DirectDnsAaaaResults {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedHost,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Results
  )
  if ($Results.Count -eq 0) { throw "Stop: Direct Connection DNS returned no records for $ExpectedHost." }
  $aaaa = @($Results | Where-Object {
    $recordHost = ([string]$_.Name).TrimEnd('.')
    $recordHost -ieq $ExpectedHost -and ([string]$_.Type -eq "AAAA") -and -not [string]::IsNullOrWhiteSpace([string]$_.IPAddress)
  })
  if ($aaaa.Count -eq 0) { throw "Stop: Direct Connection DNS has no usable AAAA record for $ExpectedHost. Next human decision: B. restore native IPv6 connectivity." }
  # Emit one array object so strict-mode callers get a collection for one or many AAAA records.
  return ,$aaaa
}

function Get-Postgres17ClientVersion {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$VersionLines)
  $version = Get-ExactlyOneNativeLine -CommandName "psql.exe --version" -OutputLines $VersionLines
  $match = [regex]::Match($version, "^psql \(PostgreSQL\) (?<major>\d+)\.(?<minor>\d+)(?:\.\d+)?$")
  if (-not $match.Success) { throw "Stop: psql.exe version output could not be parsed." }
  if ($match.Groups["major"].Value -ne "17") { throw "Stop: psql.exe major version must be 17; found $version." }
  return $version
}

function Get-NativePsqlPath {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Commands)
  if ($Commands.Count -ne 1) { throw "Stop: native psql.exe is unavailable. Next human decision: A. install/configure a native PostgreSQL 17 client." }
  $path = [string]$Commands[0].Source
  if ([string]::IsNullOrWhiteSpace($path)) { throw "Stop: native psql.exe path is unavailable. Next human decision: A. install/configure a native PostgreSQL 17 client." }
  return $path
}

function Assert-NativeIpv6Reachability {
  param(
    [Parameter(Mandatory = $true)][bool]$TcpTestSucceeded,
    [Parameter(Mandatory = $true)][string]$ComputerHost,
    [Parameter(Mandatory = $true)][string]$Port
  )
  if (-not $TcpTestSucceeded) { throw "Stop: native IPv6 TCP reachability failed for $ComputerHost`:$Port. Next human decision: B. restore native IPv6 connectivity." }
}

function New-ExclusiveTemporaryOutputFile {
  param([Parameter(Mandatory = $true)][string]$Directory, [Parameter(Mandatory = $true)][string]$RunId)
  $path = Join-Path $Directory ".operational-guardrails-authenticated-privilege-supplement.$RunId.partial.csv"
  $handle = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $handle.Dispose()
  return $path
}

function Quarantine-OrDeleteTemporaryOutput {
  param([Parameter(Mandatory = $true)][string]$TemporaryPath, [Parameter(Mandatory = $true)][string]$Directory, [Parameter(Mandatory = $true)][string]$RunId)
  if (-not (Test-Path -LiteralPath $TemporaryPath)) { return $null }
  $bytes = [int64](Get-Item -LiteralPath $TemporaryPath -ErrorAction Stop).Length
  if ($bytes -eq 0) {
    Remove-Item -LiteralPath $TemporaryPath -Force
    return $null
  }
  $quarantine = Join-Path $Directory ".operational-guardrails-authenticated-privilege-supplement.$RunId.failed.csv"
  [System.IO.File]::Move($TemporaryPath, $quarantine)
  return $quarantine
}

function Move-ValidatedTemporaryOutput {
  param([Parameter(Mandatory = $true)][string]$TemporaryPath, [Parameter(Mandatory = $true)][string]$FinalPath)
  if (Test-Path -LiteralPath $FinalPath) { throw "Stop: approved final CSV already exists; it will not be overwritten." }
  $bytes = [int64](Get-Item -LiteralPath $TemporaryPath -ErrorAction Stop).Length
  if ($bytes -eq 0) { throw "Stop: psql exited zero but produced no CSV evidence." }
  [System.IO.File]::Move($TemporaryPath, $FinalPath)
}
