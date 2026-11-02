# CI teardown is separate so GitHub cancellation still gets an always() cleanup step.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Installer CI account cleanup is restricted to GitHub-hosted disposable runners.'
}
$control = Join-Path $env:RUNNER_TEMP 'repoditor-installer-lifecycle-control\run.json'
if (-not (Test-Path -LiteralPath $control)) { return }
$run = Get-Content -LiteralPath $control -Raw | ConvertFrom-Json
if ($run.cleaned) { return }
if ($run.account -notmatch '^rdci[a-f0-9]{12}$' -or
    $run.profile -ne (Join-Path 'C:\Users' $run.account)) { throw 'Invalid disposable CI account/profile.' }
$user = Get-LocalUser -Name $run.account
if ($user.SID.Value -ne $run.sid) { throw 'Disposable CI account SID changed.' }
$stage = Join-Path $env:RUNNER_TEMP 'repoditor-installer-lifecycle'
New-Item -ItemType Directory -Path (Join-Path $stage 'results') -Force | Out-Null
function Get-DisposableProcesses {
  Get-CimInstance Win32_Process | ForEach-Object {
    $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid -ErrorAction SilentlyContinue
    if ($owner -and $owner.PSObject.Properties['Sid'] -and $owner.Sid -eq $run.sid) { $_ }
  }
}
$owned = @(Get-DisposableProcesses)
$diagnosticError = $null
try {
  $owned | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'results\cleanup-processes.json')
  # Copy startup evidence even if the worker was interrupted before its finally block.
  $tempRoot = Join-Path $run.profile 'AppData\Local\Temp'
  Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'RepoDitorInstaller-*' -ErrorAction SilentlyContinue |
    Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
    ForEach-Object {
      $log = Join-Path $_.FullName 'installer.log'
      if (Test-Path -LiteralPath $log) { Copy-Item -LiteralPath $log -Destination (Join-Path $stage "results\$($_.Name).log") }
    }
}
catch {
  $diagnosticError = $_
  Write-Warning "Could not preserve all teardown diagnostics: $_"
}
Disable-LocalUser -Name $run.account
foreach ($process in $owned) {
  # Recheck ownership/creation time before termination; never kill a recycled PID.
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)"
  if ($current -and $current.CreationDate -eq $process.CreationDate) {
    $owner = Invoke-CimMethod -InputObject $current -MethodName GetOwnerSid -ErrorAction SilentlyContinue
    if ($owner -and $owner.PSObject.Properties['Sid'] -and $owner.Sid -eq $run.sid) {
      Write-Host "Stopping disposable process $($current.Name) pid=$($current.ProcessId)"
      $result = Invoke-CimMethod -InputObject $current -MethodName Terminate
      if ($result.ReturnValue -ne 0) {
        $remaining = Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ProcessId)"
        if ($remaining -and $remaining.CreationDate -eq $current.CreationDate) {
          throw "Could not terminate disposable process $($current.ProcessId)."
        }
      }
    }
  }
}
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  $remaining = @(Get-DisposableProcesses)
  if (-not $remaining.Count) { break }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)
if ($remaining.Count) { throw "Disposable processes remain: $($remaining.ProcessId -join ',')." }
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  $profile = Get-CimInstance Win32_UserProfile -Filter "SID='$($run.sid)'"
  if (-not $profile -or -not $profile.Loaded) { break }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)
if ($profile) {
  if ($profile.Special -or $profile.Loaded -or $profile.LocalPath -ne $run.profile -or
      ((Get-Item -LiteralPath $run.profile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Disposable CI profile path/load state mismatch; refusing deletion.'
  }
  Remove-CimInstance -InputObject $profile
}
elseif (Test-Path -LiteralPath $run.profile) { throw 'Unregistered disposable profile remains; refusing filesystem deletion.' }
Remove-LocalUser -Name $run.account
if ((Get-LocalUser -Name $run.account -ErrorAction SilentlyContinue) -or
    (Test-Path -LiteralPath $run.profile) -or
    (Get-CimInstance Win32_UserProfile -Filter "SID='$($run.sid)'")) { throw 'Disposable CI account/profile cleanup incomplete.' }
$run.cleaned = $true
$run | ConvertTo-Json | Set-Content -LiteralPath $control
[ordered]@{ cleaned=$true; sid=$run.sid; profile=$run.profile } | ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $stage 'results\account-cleanup.json')
Write-Host 'Disposable CI account/profile cleanup verified.'

if ($diagnosticError) { throw $diagnosticError }
