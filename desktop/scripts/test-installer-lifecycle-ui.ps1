# Read-only UI Automation and diagnostic checks; no setup, accounts or save data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'installer-lifecycle-ui.ps1')

function Assert-UiCheck([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw $Message }
}

foreach ($name in @('Install', 'Update', 'Uninstall', 'Retry', 'Cancel')) {
  Assert-UiCheck ((Get-SafeInstallerControlName $name) -ceq $name) "Lost safe action name: $name"
}
foreach ($name in @('C:\Users\private\RepoDitor', 'token=secret', 'private user', 'unexpected error content')) {
  Assert-UiCheck ((Get-SafeInstallerControlName $name) -ceq '<redacted>') 'Diagnostic disclosed unknown control data.'
}
Assert-UiCheck ((Get-SafeInstallerControlName '') -ceq '') 'Empty UI names changed.'

$context = Get-InstallerAutomationContext (Get-Process -Id $PID)
Assert-UiCheck ($context.workerSession -eq $context.hostSession) 'Context lost the process session.'
Assert-UiCheck ($context.apartment -in @('STA', 'MTA')) 'Context omitted COM apartment.'
Assert-UiCheck ($context.desktop -ne 'unavailable') 'Worker desktop is unavailable.'

$window = [pscustomobject]@{
  buttons = @([pscustomobject]@{ Current = [pscustomobject]@{
    ControlType = [System.Windows.Automation.ControlType]::Button
    Name = 'Install'
    IsEnabled = $false
  } })
}
$window | Add-Member -MemberType ScriptMethod -Name FindAll -Value { param($Scope, $Condition) return $this.buttons }
Assert-UiCheck ($null -eq (Find-Button $window 'Install')) 'Disabled action was accepted.'
$window.buttons[0].Current.IsEnabled = $true
Assert-UiCheck ($null -ne (Find-Button $window 'Install')) 'Enabled action was rejected.'
Assert-UiCheck ($null -eq (Find-Button $window 'Uninstall')) 'Wrong action name was accepted.'
Write-Host 'PASS: UI action eligibility, context metadata, and diagnostic redaction.'
