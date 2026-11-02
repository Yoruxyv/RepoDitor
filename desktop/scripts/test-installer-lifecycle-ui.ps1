# Read-only UI Automation and diagnostic checks; no setup, accounts or save data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'installer-lifecycle-ui.ps1')

if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::MTA) {
  $rejected = $false
  try { Assert-InstallerAutomationThread }
  catch { $rejected = $_ -match 'requires a non-UI MTA worker' }
  if (-not $rejected) { throw 'STA automation was not rejected before querying UI.' }
  Write-Host 'PASS: STA worker rejected before UI Automation; restarting checks on MTA.'
  & powershell.exe -NoProfile -Mta -ExecutionPolicy Bypass -File $PSCommandPath
  exit $LASTEXITCODE
}
Assert-InstallerAutomationThread

function Assert-UiCheck([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($name in @('Install', 'Update', 'Uninstall', 'Retry', 'Cancel')) {
  Assert-UiCheck ((Get-SafeInstallerControlName $name) -ceq $name) "Lost safe action name: $name"
}
foreach ($name in @('C:\Users\private\RepoDitor', 'token=secret', 'private user', 'unexpected error content', "Install`n")) {
  Assert-UiCheck ((Get-SafeInstallerControlName $name) -ceq '<redacted>') 'Diagnostic disclosed unknown control data.'
}
Assert-UiCheck ((Get-SafeInstallerControlName '') -ceq '') 'Empty UI names changed.'

$context = Get-InstallerAutomationContext (Get-Process -Id $PID)
Assert-UiCheck ($context.workerSession -eq $context.hostSession) 'Context lost the process session.'
Assert-UiCheck ($context.apartment -ceq 'MTA') 'Context did not report the actual MTA worker.'
Assert-UiCheck ($context.desktop -ne 'unavailable') 'Worker desktop is unavailable.'

$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = Join-Path $desktopRoot 'build'
$fixtureRoot = Join-Path $buildRoot ('installer-ui-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$fixture = $null
try {
  $executable = Join-Path $fixtureRoot 'InstallerUiFixture.exe'
  & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 `
    "/out:$executable" "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationFramework.dll" `
    "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\PresentationCore.dll" `
    "/reference:$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll" /reference:System.Xaml.dll `
    (Join-Path $desktopRoot 'installer/tests/InstallerUiFixture.cs')
  Assert-UiCheck ($LASTEXITCODE -eq 0) 'UI fixture compilation failed.'
  $fixture = Start-Process $executable -WindowStyle Normal -ArgumentList ('"' + $fixtureRoot + '"') -PassThru
  $null = $fixture.Handle
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path (Join-Path $fixtureRoot 'shown')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 25 }
  Assert-UiCheck (Test-Path (Join-Path $fixtureRoot 'shown')) 'Synthetic UI did not open.'
  $handle = [IntPtr]([long](Get-Content (Join-Path $fixtureRoot 'shown')))
  $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  Assert-UiCheck ($window.Current.ProcessId -eq $fixture.Id) 'Automation targeted a different process.'
  Assert-UiCheck ($null -eq (Find-Button $window 'Install')) 'Disabled action was accepted.'
  $snapshot = @(Get-InstallerControlSnapshot $window)
  Assert-UiCheck ([bool]($snapshot | Where-Object { $_.name -eq 'Install' -and -not $_.enabled })) 'Snapshot lost the disabled action.'
  Assert-UiCheck (($snapshot | ConvertTo-Json -Compress) -notmatch 'synthetic-private-path') 'Snapshot disclosed private control text.'
  Assert-UiCheck ($null -eq (Find-Button $window 'Uninstall')) 'Wrong action name was accepted.'
  [IO.File]::WriteAllText((Join-Path $fixtureRoot 'enable'), '')
  $button = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(5)
  while ($null -eq $button -and [DateTime]::UtcNow -lt $deadline) {
    $button = Find-Button $window 'Install'
    if ($null -eq $button) { Start-Sleep -Milliseconds 25 }
  }
  if ($null -eq $button) { Write-Host (@(Get-InstallerControlSnapshot $window) | ConvertTo-Json -Compress) }
  Assert-UiCheck ($null -ne $button) "Initialized action was not found; providerEnabled=$(Test-Path (Join-Path $fixtureRoot 'enabled'))."
  $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  Assert-UiCheck ($fixture.WaitForExit(5000)) 'Invoked UI did not exit.'
  Assert-UiCheck ((Get-Content (Join-Path $fixtureRoot 'invoked')) -ceq 'Install') 'Actual accessible action was not invoked.'
  Write-Host 'PASS: real UIA disabled/initialized actions, process ownership, invocation, context and redaction.'
}
finally {
  if ($fixture -and -not $fixture.HasExited) {
    $fixture.Kill()
    $null = $fixture.WaitForExit(5000)
  }
  $resolved = [IO.Path]::GetFullPath($fixtureRoot)
  if (-not $resolved.StartsWith($buildRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'UI fixture cleanup escaped build.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
