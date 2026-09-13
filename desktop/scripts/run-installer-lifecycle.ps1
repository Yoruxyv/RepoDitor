#requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Run', 'Create', 'Cleanup')][string] $Mode = 'Run',
  [string] $ControlPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSVersion.Major -lt 7) {
  $pwshCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  $candidates = @(
    $(if ($pwshCommand) { $pwshCommand.Source }),
    (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\pwsh.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe')
  )
  $pwsh = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if (-not $pwsh) { throw 'Install PowerShell 7 before running visible installer acceptance.' }
  $forward = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-Mode', $Mode)
  if ($ControlPath) { $forward += @('-ControlPath', $ControlPath) }
  & $pwsh @forward
  exit $LASTEXITCODE
}
if (-not $IsWindows) { throw 'Visible installer acceptance requires Windows and PowerShell 7.' }
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = Join-Path $desktopRoot 'build'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdministrator = ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$shell = (Get-Process -Id $PID).Path

function Quote-Path([string] $Path) { return '"' + $Path + '"' }

function Invoke-Management([string] $Phase) {
  $process = Start-Process -FilePath $shell -Verb RunAs -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Quote-Path $PSCommandPath),
    '-Mode', $Phase, '-ControlPath', (Quote-Path $ControlPath)
  ) -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "$Phase failed; inspect $ControlPath\$Phase-error.json." }
}

if ($Mode -ne 'Run') {
  # Administrative actions can target only a fresh, named QA control directory.
  if (-not $ControlPath) { throw 'A private QA control directory is required.' }
  $ControlPath = [IO.Path]::GetFullPath($ControlPath)
  $runRoot = Split-Path $ControlPath
  $runName = Split-Path $runRoot -Leaf
  if ($runName -notmatch '^installer-lifecycle-[a-f0-9]{32}$' -or
      $runRoot -ne (Join-Path $buildRoot $runName) -or
      $ControlPath -ne (Join-Path $runRoot 'control')) { throw 'Control path escaped the dedicated QA build directory.' }
  $stage = Join-Path $runRoot 'stage'
  foreach ($path in @($buildRoot, $runRoot, $ControlPath, $stage)) {
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'QA control path is redirected.' }
  }
  $run = Get-Content -LiteralPath (Join-Path $ControlPath 'run.json') | ConvertFrom-Json
  if (-not $isAdministrator -or $identity.User.Value -ne $run.RequesterSID) {
    throw 'Account management requires UAC under the same Windows identity as the unelevated launcher.'
  }
  if ($run.Account -notmatch '^rdp16[a-f0-9]{10}$' -or $run.Profile -ne (Join-Path 'C:\Users' $run.Account)) { throw 'Invalid disposable account/profile.' }
  try {
    if ($Mode -eq 'Create') {
      if ((Get-LocalUser -Name $run.Account -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath $run.Profile)) { throw 'Refusing an existing account/profile.' }
      $password = ConvertTo-SecureString ('P16!a' + [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))) -AsPlainText -Force
      $user = New-LocalUser -Name $run.Account -Password $password -Description 'RepoDitor disposable visible installer QA' -AccountExpires ([DateTime]::Now.AddDays(1)) -UserMayNotChangePassword
      [ordered]@{Account=$run.Account;SID=$user.SID.Value;Profile=$run.Profile} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ControlPath 'created.json')
      Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $user
      [PSCredential]::new("$env:COMPUTERNAME\$($run.Account)", $password) | Export-Clixml -LiteralPath (Join-Path $ControlPath 'credential.clixml')
      & icacls.exe $stage /grant "*$($user.SID.Value):(OI)(CI)M"
      if ($LASTEXITCODE -ne 0) { throw 'Could not grant access to the isolated QA stage.' }
    }
    else {
      $created = Get-Content -LiteralPath (Join-Path $ControlPath 'created.json') | ConvertFrom-Json
      $user = Get-LocalUser -Name $run.Account
      if ($created.Account -ne $run.Account -or $created.Profile -ne $run.Profile -or $user.SID.Value -ne $created.SID) { throw 'Disposable account SID changed.' }
      $profileInfo = Get-CimInstance Win32_UserProfile -Filter "SID='$($created.SID)'"
      if ($profileInfo) {
        $postflight = Get-Content -LiteralPath (Join-Path $stage 'results\postflight.json') | ConvertFrom-Json
        if (-not $postflight.Passed -or $postflight.SID -ne $created.SID -or $postflight.Profile -ne $run.Profile) { throw 'Authoritative disposable postflight did not pass.' }
        if ($profileInfo.Special -or $profileInfo.Loaded -or $profileInfo.LocalPath -ne $run.Profile -or
            ((Get-Item -LiteralPath $run.Profile -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Disposable profile path/load state mismatch.' }
      }
      elseif (Test-Path -LiteralPath (Join-Path $ControlPath 'worker-started.json')) { throw 'Worker profile disappeared without verified cleanup.' }
      $ownedProcesses = @(Get-CimInstance Win32_Process | ForEach-Object {
        $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid -ErrorAction SilentlyContinue
        if ($owner -and $owner.PSObject.Properties['Sid'] -and $owner.Sid -eq $created.SID) { $_.ProcessId }
      })
      if ($ownedProcesses.Count) { throw "Disposable processes remain: $($ownedProcesses -join ',')." }
      Disable-LocalUser -Name $run.Account
      if ($profileInfo) { Remove-CimInstance -InputObject $profileInfo }
      Remove-LocalUser -Name $run.Account
      if ((Get-LocalUser -Name $run.Account -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath $run.Profile) -or
          (Get-CimInstance Win32_UserProfile -Filter "SID='$($created.SID)'")) { throw 'Account/profile cleanup incomplete.' }
      $credentialPath = Join-Path $ControlPath 'credential.clixml'
      if (Test-Path -LiteralPath $credentialPath) { Remove-Item -LiteralPath $credentialPath -Force }
      [ordered]@{Passed=$true;Account=$run.Account;SID=$created.SID;Profile=$run.Profile;CredentialRemoved=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'cleanup.json')
    }
  }
  catch {
    [ordered]@{Passed=$false;Error=$_.Exception.ToString();Account=$run.Account} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ControlPath "$Mode-error.json")
    Write-Error $_ -ErrorAction Continue
    exit 1
  }
  exit 0
}

if ($ControlPath) { throw 'Run creates its own isolated control directory.' }
if ($isAdministrator -or -not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) {
  throw 'Run from an unelevated interactive Windows terminal; UAC is used only for disposable account management.'
}
$artifacts = @(Get-ChildItem -LiteralPath (Join-Path $desktopRoot 'release') -Filter 'RepoDitor-Setup-*-x64.exe' -File)
if ($artifacts.Count -ne 1) { throw 'Build the production installer first with npm run package.' }
$nonce = [guid]::NewGuid().ToString('N')
$runRoot = Join-Path $buildRoot "installer-lifecycle-$nonce"
$ControlPath = Join-Path $runRoot 'control'
$stage = Join-Path $runRoot 'stage'
if (Test-Path -LiteralPath $runRoot) { throw 'QA directory collision.' }
New-Item -ItemType Directory -Path $ControlPath, $stage | Out-Null
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity.User.Value, 'S-1-5-32-544', 'S-1-5-18')) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
}
Set-Acl -LiteralPath $ControlPath -AclObject $acl
$account = 'rdp16' + $nonce.Substring(0, 10)
$profile = Join-Path 'C:\Users' $account
[ordered]@{Account=$account;Profile=$profile;RequesterSID=$identity.User.Value} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ControlPath 'run.json')
Copy-Item -LiteralPath $artifacts[0].FullName -Destination (Join-Path $stage 'setup.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'test-installer-lifecycle.ps1') -Destination (Join-Path $stage 'lifecycle.ps1')
if ((Get-FileHash -LiteralPath $artifacts[0].FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $stage 'setup.exe')).Hash) { throw 'Staged installer differs from production artifact.' }
Write-Host "Visible installer QA: disposable account $account. Watch the windows; do not click them."
Write-Host "Results: $stage\results. Windows UAC manages only this test account."
$exitCode = 0
try {
  Invoke-Management 'Create'
  $created = Get-Content -LiteralPath (Join-Path $ControlPath 'created.json') | ConvertFrom-Json
  $credential = Import-Clixml -LiteralPath (Join-Path $ControlPath 'credential.clixml')
  $workerEnvironment = @{
    USERPROFILE=$profile;HOMEDRIVE='C:';HOMEPATH="\Users\$account"
    APPDATA=(Join-Path $profile 'AppData\Roaming');LOCALAPPDATA=(Join-Path $profile 'AppData\Local')
    TEMP=(Join-Path $profile 'AppData\Local\Temp');TMP=(Join-Path $profile 'AppData\Local\Temp')
  }
  [ordered]@{SID=$created.SID;Profile=$profile} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ControlPath 'worker-started.json')
  $worker = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Credential $credential -LoadUserProfile -Environment $workerEnvironment -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Quote-Path (Join-Path $stage 'lifecycle.ps1')),
    '-SetupPath', (Quote-Path (Join-Path $stage 'setup.exe')), '-ResultsPath', (Quote-Path (Join-Path $stage 'results')),
    '-ObserveSetupUi', '-RequireUnelevated', '-ExpectedDisposableProfile', (Quote-Path $profile), '-ExpectedDisposableSID', $created.SID
  ) -RedirectStandardOutput (Join-Path $stage 'worker.stdout.log') -RedirectStandardError (Join-Path $stage 'worker.stderr.log') -PassThru -Wait
  Get-Content -LiteralPath (Join-Path $stage 'worker.stdout.log')
  Get-Content -LiteralPath (Join-Path $stage 'worker.stderr.log')
  $summary = Get-Content -LiteralPath (Join-Path $stage 'results\summary.json') | ConvertFrom-Json
  if (($null -ne $worker.ExitCode -and $worker.ExitCode -ne 0) -or -not $summary.succeeded) { throw "Lifecycle failed: $($summary.failure)" }
}
catch { $exitCode = 1; Write-Error $_ -ErrorAction Continue }
finally {
  if (Test-Path -LiteralPath (Join-Path $ControlPath 'created.json')) {
    try { Invoke-Management 'Cleanup' }
    catch { $exitCode = 1; Write-Warning "Cleanup refused: $_ Test account retained for diagnosis: $account. Receipts: $ControlPath" }
  }
}
if ($exitCode -eq 0) { Write-Host 'PASS: visible production lifecycle and disposable account/profile cleanup.' }
exit $exitCode
