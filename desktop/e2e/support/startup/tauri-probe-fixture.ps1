param(
    [Parameter(Mandatory)][string]$Marker,
    [ValidateSet('responsive', 'hung', 'exited', 'inaccessible')][string]$Mode,
    [string]$Interop
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'load-tauri-probe-interop.ps1') $Interop
if ($Mode -ne 'exited') { [TauriProbeFixture]::CreateWindow() }
if ($Mode -eq 'inaccessible') { [TauriProbeFixture]::DenyInspection() }
[IO.File]::WriteAllText($Marker, [string]$PID)
if ($Mode -eq 'responsive') { [TauriProbeFixture]::Pump() }
elseif ($Mode -ne 'exited') { [TauriProbeFixture]::Hang() }
