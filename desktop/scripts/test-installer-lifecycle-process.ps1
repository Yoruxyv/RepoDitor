# Synthetic processes and temporary journals only: no installer, registry, account or profile operations.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'installer-lifecycle-process.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('repoditor-supervision-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$shell = (Get-Process -Id $PID).Path
$children = [Collections.Generic.List[Diagnostics.Process]]::new()
function Assert-Check([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw $Message }
}
function Start-SyntheticWorker([string] $Stage, [string] $Body) {
  New-Item -ItemType Directory -Path (Join-Path $Stage 'results') -Force | Out-Null
  $scriptPath = Join-Path $Stage 'worker.ps1'
  Set-Content -LiteralPath $scriptPath -Value $Body
  $process = Start-Process -FilePath $shell -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-File', ('"' + $scriptPath + '"')
  ) -RedirectStandardOutput (Join-Path $Stage 'worker.stdout.log') -RedirectStandardError (Join-Path $Stage 'worker.stderr.log') -PassThru
  $children.Add($process)
  return $process
}
try {
  $success = Join-Path $root 'success'
  $worker = Start-SyntheticWorker $success @'
'{"succeeded":true}' | Set-Content (Join-Path $PSScriptRoot 'results/summary.json')
'{"Passed":true}' | Set-Content (Join-Path $PSScriptRoot 'results/postflight.json')
Write-Host 'synthetic-success'
'@
  Wait-LifecycleWorker $worker $success 15

  foreach ($case in @(
    @{ name='nonzero'; error='exited 7'; body='exit 7' },
    @{ name='missing'; error='summary.json.*does not exist'; body='exit 0' },
    @{ name='partial'; error='JSON'; body=@'
'{"succeeded":' | Set-Content (Join-Path $PSScriptRoot 'results/summary.json')
'@ },
    @{ name='failure'; error='synthetic failure'; body=@'
'{"succeeded":false,"failure":"synthetic failure"}' | Set-Content (Join-Path $PSScriptRoot 'results/summary.json')
'@ },
    @{ name='no-postflight'; error='postflight.json.*does not exist'; body=@'
'{"succeeded":true}' | Set-Content (Join-Path $PSScriptRoot 'results/summary.json')
'@ },
    @{ name='timeout'; error='timed out after 1 seconds'; body='Start-Sleep -Seconds 60' }
  )) {
    $stage = Join-Path $root $case.name
    $worker = Start-SyntheticWorker $stage $case.body
    $workerId = $worker.Id
    $failed = $false
    try { Wait-LifecycleWorker $worker $stage $(if ($case.name -eq 'timeout') { 1 } else { 15 }) }
    catch {
      Assert-Check ($_ -match $case.error) "$($case.name) failed for an unexpected reason: $_"
      $failed = $true
      Write-Host "PASS: $($case.name) rejected: $_"
    }
    Assert-Check $failed "$($case.name) was incorrectly accepted."
    Assert-Check (-not (Get-Process -Id $workerId -ErrorAction SilentlyContinue)) "$($case.name) left its worker running."
  }

  # Reproduce the original topology: completed worker journal, surviving descendant.
  $stage = Join-Path $root 'descendant'
  $worker = Start-SyntheticWorker $stage @'
$child = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -Command Start-Sleep -Seconds 60' -PassThru
$child.Id | Set-Content (Join-Path $PSScriptRoot 'child.pid')
'{"succeeded":false,"failure":"synthetic readiness failure"}' | Set-Content (Join-Path $PSScriptRoot 'results/summary.json')
'@
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $failed = $false
  try { Wait-LifecycleWorker $worker $stage 15 }
  catch { $failed = $true }
  Assert-Check ($failed -and $clock.Elapsed.TotalSeconds -lt 15) 'Surviving descendant blocked worker failure reporting.'
  $childId = [int](Get-Content -LiteralPath (Join-Path $stage 'child.pid'))
  $child = Get-Process -Id $childId
  $children.Add($child)
  Assert-Check (-not $child.HasExited) 'Synthetic descendant did not reproduce the orphan topology.'
  Stop-LifecycleProcess $child
  Write-Host 'PASS: worker exit does not wait for descendants; owned descendant cleanup verified.'

  $stage = Join-Path $root 'cancelled'
  $worker = Start-SyntheticWorker $stage 'Start-Sleep -Seconds 60'
  $workerId = $worker.Id
  $pipeline = [PowerShell]::Create()
  try {
    $null = $pipeline.AddScript({
      param($Helper, $WorkerId, $Stage)
      . $Helper
      Wait-LifecycleWorker (Get-Process -Id $WorkerId) $Stage 30
    }).AddArgument((Join-Path $PSScriptRoot 'installer-lifecycle-process.ps1')).AddArgument($workerId).AddArgument($stage)
    $null = $pipeline.BeginInvoke()
    Start-Sleep -Milliseconds 500
    $pipeline.Stop()
    Assert-Check (-not (Get-Process -Id $workerId -ErrorAction SilentlyContinue)) 'Cancellation left its owned worker running.'
    Write-Host 'PASS: pipeline cancellation terminates the owned worker.'
  }
  finally { $pipeline.Dispose() }

  if ($env:GITHUB_ACTIONS -ne 'true') {
    $refused = $false
    try { & (Join-Path $PSScriptRoot 'cleanup-installer-lifecycle-ci.ps1') }
    catch { $refused = $_ -match 'restricted to GitHub-hosted' }
    Assert-Check $refused 'CI cleanup did not reject the local profile.'
  }
  # Malformed/tampered receipts must fail before any account or profile mutation.
  $savedEnvironment = @{}
  foreach ($name in @('GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_TEMP')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
  }
  try {
    $env:GITHUB_ACTIONS = 'true'
    $env:RUNNER_ENVIRONMENT = 'github-hosted'
    $env:RUNNER_TEMP = $root
    $control = Join-Path $root 'repoditor-installer-lifecycle-control'
    New-Item -ItemType Directory -Path $control | Out-Null
    function Get-LocalUser { return [pscustomobject]@{ SID=[pscustomobject]@{ Value='synthetic-other-sid' } } }
    function Remove-LocalUser { throw 'Unexpected account mutation in synthetic test.' }
    function Disable-LocalUser { throw 'Unexpected account mutation in synthetic test.' }
    function Remove-CimInstance { throw 'Unexpected profile mutation in synthetic test.' }
    foreach ($case in @(
      @{ profile=$env:USERPROFILE; error='Invalid disposable CI account/profile' },
      @{ profile='C:\Users\rdci0123456789ab'; error='account SID changed' }
    )) {
      @{ account='rdci0123456789ab'; profile=$case.profile; sid='synthetic-sid'; cleaned=$false } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $control 'run.json')
      $refused = $false
      try { & (Join-Path $PSScriptRoot 'cleanup-installer-lifecycle-ci.ps1') }
      catch { $refused = $_ -match $case.error }
      Assert-Check $refused "Unsafe receipt was not rejected: $($case.error)"
    }
  }
  finally {
    foreach ($name in $savedEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name])
    }
  }
  Write-Host 'PASS: disposable cleanup rejects profile and SID mismatches.'
  Write-Host 'PASS: lifecycle supervision failure paths.'
}
finally {
  foreach ($child in $children) {
    Stop-LifecycleProcess $child
  }
  $resolvedRoot = [IO.Path]::GetFullPath($root)
  if ($resolvedRoot -ne (Join-Path ([IO.Path]::GetTempPath()) (Split-Path $root -Leaf)) -or
      (Split-Path $root -Leaf) -notmatch '^repoditor-supervision-[a-f0-9]{32}$') { throw 'Synthetic cleanup escaped its temporary directory.' }
  Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}
