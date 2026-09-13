[CmdletBinding()]
param(
  [string] $SetupPath,
  [string] $ResultsPath = (Join-Path $PSScriptRoot '..\build\installer-lifecycle-results'),
  [switch] $RequireUnelevated,
  [switch] $ObserveSetupUi,
  [string] $ExpectedDisposableProfile,
  [string] $ExpectedDisposableSID
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resultsRoot = [IO.Path]::GetFullPath($ResultsPath)
$allowedBuildRoot = [IO.Path]::GetFullPath((Join-Path $desktopRoot 'build'))
if (-not $resultsRoot.StartsWith($allowedBuildRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and
    $resultsRoot -ne [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'results'))) {
  throw 'Lifecycle results cleanup must stay in desktop/build or the staged results directory.'
}
if ($ExpectedDisposableProfile -or $ExpectedDisposableSID) {
  $workerIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $workerProfile = [Environment]::GetFolderPath('UserProfile')
  $disposableName = [IO.Path]::GetFileName($ExpectedDisposableProfile)
  if ($disposableName -notmatch '^rd(?:p16[a-f0-9]{10}|ci[a-f0-9]{12})$' -or
      $workerIdentity.User.Value -ne $ExpectedDisposableSID -or
      $workerIdentity.Name -ne "$env:COMPUTERNAME\$disposableName" -or
      $workerProfile -ne (Join-Path 'C:\Users' $disposableName) -or
      $workerProfile -ne $ExpectedDisposableProfile -or
      [Environment]::GetFolderPath('ApplicationData') -ne (Join-Path $workerProfile 'AppData\Roaming') -or
      [Environment]::GetFolderPath('LocalApplicationData') -ne (Join-Path $workerProfile 'AppData\Local')) {
    throw 'Disposable worker identity or known-folder isolation mismatch; refusing lifecycle work.'
  }
}
if (Test-Path -LiteralPath $resultsRoot) {
  Remove-Item -LiteralPath $resultsRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $resultsRoot | Out-Null
$logPath = Join-Path $resultsRoot 'lifecycle.log'
$summaryPath = Join-Path $resultsRoot 'summary.json'
$observations = [Collections.Generic.List[object]]::new()
$createdGameData = $false
$gameDataRoot = $null
$succeeded = $false
$failure = $null

function Write-LifecycleLog([string] $Message) {
  $line = '[{0:O}] {1}' -f [DateTime]::UtcNow, $Message
  Write-Host $line
  [IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine)
}

function Add-Observation([string] $Scenario, [string] $Stage, [string] $Result) {
  $observations.Add([pscustomobject]@{
    scenario = $Scenario
    stage = $Stage
    result = $Result
  })
  Write-LifecycleLog "$Scenario | $Stage | $Result"
}

function Assert-True([bool] $Condition, [string] $Message) {
  if (-not $Condition) { throw $Message }
}

function Normalize-Path([string] $Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Assert-PathEqual([string] $Actual, [string] $Expected, [string] $Message) {
  if (-not [string]::Equals(
    (Normalize-Path $Actual),
    (Normalize-Path $Expected),
    [StringComparison]::OrdinalIgnoreCase
  )) {
    throw "$Message Expected '$Expected', found '$Actual'."
  }
}

function Get-GameFingerprint([string] $Root) {
  $files = @(Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName)
  return @($files | ForEach-Object {
    [pscustomobject]@{
      path = $_.FullName.Substring($Root.Length).TrimStart('\')
      size = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  })
}

function Assert-GameData([string] $Stage) {
  Assert-True (Test-Path -LiteralPath $script:gameDataRoot -PathType Container) `
    "Synthetic R.E.P.O. tree disappeared after $Stage."
  $current = Get-GameFingerprint $script:gameDataRoot | ConvertTo-Json -Compress
  if ($current -cne $script:gameFingerprint) {
    throw "Synthetic R.E.P.O. tree changed after $Stage."
  }
  Add-Observation 'game-data' $Stage 'fingerprint unchanged'
}

function Get-RegisteredInstallLocation {
  Assert-True (Test-Path -LiteralPath $script:appKey) 'HKCU application registration is missing.'
  return [string](Get-ItemProperty -LiteralPath $script:appKey).InstallLocation
}

function Assert-Installed([string] $Scenario, [string] $ExpectedPath) {
  $registeredPath = Get-RegisteredInstallLocation
  Assert-PathEqual $registeredPath $ExpectedPath "$Scenario InstallLocation mismatch."
  Assert-True (Test-Path -LiteralPath $script:uninstallKey) "$Scenario uninstall registration is missing."

  $uninstallRegistration = Get-ItemProperty -LiteralPath $script:uninstallKey
  Assert-True ($uninstallRegistration.DisplayName -eq 'RepoDitor') `
    "$Scenario uninstall DisplayName is invalid."
  Assert-True ([string]$uninstallRegistration.UninstallString -match [regex]::Escape('Uninstall RepoDitor.exe')) `
    "$Scenario UninstallString does not target the installed uninstaller."

  foreach ($relativePath in @(
    'RepoDitor.exe',
    'Uninstall RepoDitor.exe',
    'resources\app.asar',
    'resources\backend\repoditor-backend.exe'
  )) {
    Assert-True (Test-Path -LiteralPath (Join-Path $ExpectedPath $relativePath) -PathType Leaf) `
      "$Scenario payload is missing $relativePath."
  }
  Add-Observation $Scenario 'installed state' "valid at $registeredPath"
  Add-Observation $Scenario 'payload' 'RepoDitor.exe, installed uninstaller, app.asar, Python backend present'
}

function Assert-Uninstalled([string] $Scenario, [string] $InstallPath) {
  $remaining = @()
  if (Test-Path -LiteralPath $script:appKey) { $remaining += 'HKCU application key' }
  if (Test-Path -LiteralPath $script:uninstallKey) { $remaining += 'HKCU uninstall key' }
  foreach ($relativePath in @(
    'RepoDitor.exe',
    'Uninstall RepoDitor.exe',
    'resources\app.asar',
    'resources\backend\repoditor-backend.exe'
  )) {
    if (Test-Path -LiteralPath (Join-Path $InstallPath $relativePath)) {
      $remaining += $relativePath
    }
  }
  if ($remaining.Count -gt 0) {
    throw "$Scenario reported success while authoritative installed state remained: $($remaining -join ', ')."
  }
  Assert-True (-not (Test-Path -LiteralPath $InstallPath)) "$Scenario installation directory remains."
  Add-Observation $Scenario 'uninstall postconditions' 'registration and payload gone'
}

function Invoke-Setup([string] $Scenario, [string] $ExpectedPath) {
  if ($ObserveSetupUi -and $ExpectedPath -eq $script:defaultInstallPath) {
    Invoke-WebViewOperation $Scenario $ExpectedPath 'install'
    return
  }
  # Mirror InstallerEngine.RunAsync(): production installs always pass the
  # authoritative selected path, including the normal default location.
  $arguments = @('/S', '/currentuser', "/D=$ExpectedPath")
  Write-LifecycleLog "$Scenario | setup start | executable=$script:setupPath arguments=$($arguments -join ' ')"
  $process = Start-Process -FilePath $script:setupPath -ArgumentList $arguments -PassThru

  if (-not $process.WaitForExit(180000)) {
    Write-LifecycleLog "$Scenario | setup timeout | pid=$($process.Id)"

    $children = @(
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ParentProcessId -eq $process.Id } |
        ForEach-Object { "$($_.Name) pid=$($_.ProcessId)" }
    )

    if ($children.Count -gt 0) {
      Write-LifecycleLog "$Scenario | setup timeout children | $($children -join ', ')"
    }

    & taskkill.exe /PID $process.Id /T /F | Out-Null
    throw "$Scenario setup timed out after 180 seconds."
  }

  $process.Refresh()
  Add-Observation $Scenario 'setup exit' ([string]$process.ExitCode)
  if ($process.ExitCode -ne 0) {
    $payload = if (Test-Path -LiteralPath $ExpectedPath) {
      @(Get-ChildItem -LiteralPath $ExpectedPath -Force | ForEach-Object Name) -join ', '
    } else {
      '<destination absent>'
    }
    Write-LifecycleLog "$Scenario | failed destination | path=$ExpectedPath contents=$payload"
  }
  Assert-True ($process.ExitCode -eq 0) "$Scenario setup exited $($process.ExitCode)."
  Assert-Installed $Scenario $ExpectedPath
  Assert-GameData "$Scenario setup"
}

function Find-Button($Window, [string] $Name) {
  return $Window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  ) | Where-Object {
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
    $_.Current.Name -eq $Name
  } | Select-Object -First 1
}

function Invoke-WebViewOperation(
  [string] $Scenario,
  [string] $InstallPath,
  [string] $Mode = 'uninstall',
  [string] $FailureSentinel = ''
) {
  $entry = if ($Mode -eq 'install') { $script:setupPath } else { Join-Path $InstallPath 'Uninstall RepoDitor.exe' }
  Assert-True (Test-Path -LiteralPath $entry -PathType Leaf) "$Scenario production entry is missing."

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $existingHosts = @(Get-Process -Name RepoDitorInstallerHost -ErrorAction SilentlyContinue |
    ForEach-Object Id)
  Write-LifecycleLog "$Scenario | $Mode UI start | executable=$entry arguments=/currentuser"
  $entryProcess = Start-Process -FilePath $entry -ArgumentList '/currentuser' -WindowStyle Normal -PassThru

  $installerHost = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ($null -eq $installerHost -and [DateTime]::UtcNow -lt $deadline) {
    $installerHost = Get-Process -Name RepoDitorInstallerHost -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Id -notin $existingHosts -and $_.Path -and
        $_.Path.StartsWith((Join-Path $script:local 'Temp\RepoDitorInstaller-'), [StringComparison]::OrdinalIgnoreCase)
      } |
      Select-Object -First 1
    if ($null -eq $installerHost) { Start-Sleep -Milliseconds 100 }
  }
  Assert-True ($null -ne $installerHost) "$Scenario WebView2 $Mode host did not start."
  Add-Observation $Scenario 'WebView2 host' "pid=$($installerHost.Id)"

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $pidCondition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
    [int]$installerHost.Id
  )
  $window = $null
  $actionButton = $null
  $actionName = if ($Mode -eq 'install') { 'Install' } else { 'Uninstall' }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ($null -eq $actionButton -and [DateTime]::UtcNow -lt $deadline) {
    $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $pidCondition)
    if ($null -ne $window) {
      $actionButton = Find-Button $window $actionName
      if ($null -eq $actionButton -and $Mode -eq 'install') {
        $actionButton = Find-Button $window 'Update'
        if ($null -ne $actionButton) { $actionName = 'Update' }
      }
    }
    if ($null -eq $actionButton) { Start-Sleep -Milliseconds 100 }
  }
  Assert-True ($null -ne $actionButton) "$Scenario WebView2 $actionName button was not available."

  $invoke = $actionButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  Add-Observation $Scenario 'WebView2 action' "$actionName invoked"

  Assert-True ($entryProcess.WaitForExit(30000)) "$Scenario production entry did not exit."
  $entryProcess.Refresh()
  Add-Observation $Scenario 'production entry exit' ([string]$entryProcess.ExitCode)
  # NSIS Quit in the install .onInit callback returns 2 after handing off to
  # WebView2. This launcher status is not the silent engine's result or success.
  $expectedEntryExit = if ($Mode -eq 'install') { 2 } else { 0 }
  Assert-True ($entryProcess.ExitCode -eq $expectedEntryExit) `
    "$Scenario production entry exited $($entryProcess.ExitCode), expected handoff status $expectedEntryExit."

  $successHeading = if ($Mode -eq 'install') { 'RepoDitor is ready' } else { 'Uninstall finished' }
  $failureHeading = if ($Mode -eq 'install') { 'Installation failed' } else { 'Uninstall failed' }
  do {
    $retryRequested = $false
    $uiResult = $null
    $uiText = @()
    $observedStages = [Collections.Generic.HashSet[string]]::new()
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ($null -eq $uiResult -and [DateTime]::UtcNow -lt $deadline) {
      $uiNodes = @($window.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
      ))
      $uiText = @($uiNodes | ForEach-Object { $_.Current.Name } | Where-Object { $_ } | Sort-Object -Unique)
      foreach ($stageText in $uiText | Where-Object { $_ -match '^(Preparing|Running|Verifying) (installation|removal)' }) {
        if ($observedStages.Add($stageText)) { Add-Observation $Scenario 'visible stage' $stageText }
      }
      Assert-True (-not ($uiText | Where-Object { $_ -match '\d+(?:\.\d+)?\s*%' })) "$Scenario displayed numeric progress."
      if ($uiText -contains $successHeading) { $uiResult = 'finished' }
      if ($uiText -contains $failureHeading) { $uiResult = 'failed' }
      if ($null -eq $uiResult) { Start-Sleep -Milliseconds 100 }
    }
    Add-Observation $Scenario 'WebView2 result' ([string]$uiResult)
    if ($uiResult) {
      Assert-True (-not ($uiText -contains $successHeading -and $uiText -contains $failureHeading)) `
        "$Scenario displayed success and failure together."
      Assert-True (-not ($uiNodes | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ProgressBar })) `
        "$Scenario terminal UI retained a progress indicator."
      Add-Observation $Scenario 'terminal progress' 'indicator absent; no numeric percentage observed'
    }
    if ($FailureSentinel) {
      Assert-True ($Mode -eq 'install' -and $uiResult -eq 'failed') "$Scenario expected native installation refusal."
      Assert-True ($FailureSentinel -eq (Join-Path $InstallPath 'refusal-sentinel.txt')) 'Refusal sentinel escaped its synthetic target.'
      Assert-True (-not (Test-Path -LiteralPath $script:appKey) -and -not (Test-Path -LiteralPath $script:uninstallKey)) `
        "$Scenario failure created authoritative registration."
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallPath 'RepoDitor.exe'))) "$Scenario failure installed an executable."
      Assert-True ([IO.File]::ReadAllText($FailureSentinel) -ceq 'synthetic-refusal-only') 'Native refusal changed the synthetic sentinel.'
      Assert-GameData "$Scenario failure"
      $retryButton = Find-Button $window 'Retry'
      Assert-True ($null -ne $retryButton -and $null -eq (Find-Button $window 'Launch RepoDitor')) `
        "$Scenario failure offered success instead of Retry."
      # Resolve this deliberate native path refusal, then invoke one real user
      # Retry. No automatic retries, injected messages, or product test hooks.
      Remove-Item -LiteralPath $FailureSentinel -Force
      $FailureSentinel = ''
      $retryButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      Add-Observation $Scenario 'WebView2 retry' 'Retry invoked after resolving synthetic path refusal'
      $retryRequested = $true
    }
  } while ($retryRequested)
  if ($uiResult -ne 'finished') {
    throw "$Scenario WebView2 $Mode failed or timed out. UI text: $($uiText -join ' | ')"
  }

  if ($Mode -eq 'install') { Assert-Installed $Scenario $InstallPath }
  else { Assert-Uninstalled $Scenario $InstallPath }
  Assert-GameData "$Scenario $Mode"
  $closeButton = Find-Button $window 'Close'
  if ($null -ne $closeButton) {
    $closeButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
  }
  Assert-True ($installerHost.WaitForExit(30000)) "$Scenario completed host did not close."
}

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($RequireUnelevated -and $isAdministrator) {
    throw 'Lifecycle worker must run as a standard unelevated user.'
  }

  if ([string]::IsNullOrWhiteSpace($SetupPath)) {
    $installers = @(Get-ChildItem (Join-Path $desktopRoot 'release') `
      -Filter 'RepoDitor-Setup-*-x64.exe' -File)
    if ($installers.Count -ne 1) {
      throw "Expected exactly one production installer, found $($installers.Count)."
    }
    $SetupPath = $installers[0].FullName
  }
  $setupPath = [IO.Path]::GetFullPath($SetupPath)
  Assert-True (Test-Path -LiteralPath $setupPath -PathType Leaf) "Installer is missing: $setupPath"

  $roaming = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
  $local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  $profile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  $appKey = 'HKCU:\Software\7bf293cf-c9df-5f51-b0ff-35bc10c7effc'
  $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\7bf293cf-c9df-5f51-b0ff-35bc10c7effc'
  $ownedDataRoots = @(
    (Join-Path $roaming 'repoditor-desktop'),
    (Join-Path $local 'RepoDitor')
  )
  $gameDataRoot = Join-Path $profile 'AppData\LocalLow\semiwork\Repo'
  $defaultInstallPath = Join-Path $local 'Programs\RepoDitor'
  $customInstallPath = Join-Path (Join-Path $local 'Temp') `
    "repoditor-installer-lifecycle-$([Guid]::NewGuid().ToString('N'))\RepoDitor"

  Write-LifecycleLog "host user=$($identity.Name) administrator=$isAdministrator"
  Write-LifecycleLog "setup=$setupPath sha256=$((Get-FileHash $setupPath -Algorithm SHA256).Hash)"
  foreach ($path in @($appKey, $uninstallKey, $defaultInstallPath, $gameDataRoot) + $ownedDataRoots) {
    if (Test-Path -LiteralPath $path) {
      throw "Safety preflight refused existing state: $path"
    }
  }

  foreach ($directory in @($roaming, $local, (Join-Path $local 'Temp'))) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  Write-LifecycleLog "profile=$profile roaming=$roaming local=$local temp=$(Join-Path $local 'Temp')"

  New-Item -ItemType Directory -Path (Join-Path $gameDataRoot 'Saves\qa-slot') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $gameDataRoot 'settings') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $gameDataRoot 'MetaSave.es3'), 'synthetic-meta-v1')
  [IO.File]::WriteAllText((Join-Path $gameDataRoot 'Saves\qa-slot\REPO_SAVE_QA.es3'), 'synthetic-save-v1')
  [IO.File]::WriteAllText((Join-Path $gameDataRoot 'settings\graphics.json'), '{"quality":3}')
  $createdGameData = $true
  $gameFingerprint = Get-GameFingerprint $gameDataRoot | ConvertTo-Json -Compress
  Add-Observation 'game-data' 'baseline' $gameFingerprint

  Invoke-Setup 'current-user-default-install' $defaultInstallPath

  foreach ($root in $ownedDataRoots) {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'upgrade-sentinel.txt'), 'preserve-on-update')
  }
  $ownedSentinelHashes = @{}
  foreach ($root in $ownedDataRoots) {
    $ownedSentinelHashes[$root] = (Get-FileHash -LiteralPath (Join-Path $root 'upgrade-sentinel.txt')).Hash
  }
  Invoke-Setup 'current-user-default-update' $defaultInstallPath
  foreach ($root in $ownedDataRoots) {
    Assert-True (Test-Path -LiteralPath (Join-Path $root 'upgrade-sentinel.txt') -PathType Leaf) `
      "Update removed RepoDitor-owned AppData sentinel: $root"
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $root 'upgrade-sentinel.txt')).Hash -eq $ownedSentinelHashes[$root]) `
      "Update changed RepoDitor-owned AppData sentinel: $root"
  }
  Add-Observation 'current-user-default-update' 'AppData' 'sentinels retained'

  Invoke-WebViewOperation 'current-user-default-uninstall' $defaultInstallPath
  foreach ($root in $ownedDataRoots) {
    Assert-True (-not (Test-Path -LiteralPath $root)) `
      "Explicit uninstall left RepoDitor-owned AppData: $root"
  }
  Add-Observation 'current-user-default-uninstall' 'AppData' 'owned roots removed'

  Invoke-Setup 'current-user-custom-install' $customInstallPath
  foreach ($root in $ownedDataRoots) {
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $root 'custom-uninstall-sentinel.txt'), 'remove-on-explicit-uninstall')
  }
  Add-Observation 'current-user-custom-uninstall' 'AppData baseline' 'owned roots populated with synthetic sentinels'
  Invoke-WebViewOperation 'current-user-custom-uninstall' $customInstallPath
  foreach ($root in $ownedDataRoots) {
    Assert-True (-not (Test-Path -LiteralPath $root)) "Custom uninstall left RepoDitor-owned AppData: $root"
  }
  Add-Observation 'current-user-custom-uninstall' 'AppData' 'owned roots removed'
  if ($ObserveSetupUi) {
    Assert-True (-not (Test-Path -LiteralPath $defaultInstallPath)) 'Refusal test target is not clean.'
    New-Item -ItemType Directory -Path $defaultInstallPath | Out-Null
    $refusalSentinel = Join-Path $defaultInstallPath 'refusal-sentinel.txt'
    [IO.File]::WriteAllText($refusalSentinel, 'synthetic-refusal-only')
    Invoke-WebViewOperation 'native-failure-and-real-retry' $defaultInstallPath 'install' $refusalSentinel
    Invoke-WebViewOperation 'retry-install-clean-uninstall' $defaultInstallPath
    foreach ($root in $ownedDataRoots) {
      Assert-True (-not (Test-Path -LiteralPath $root)) "Retry cleanup left RepoDitor-owned AppData: $root"
    }
  }
  $succeeded = $true
}
catch {
  $failure = $_.Exception.ToString()
  Write-LifecycleLog "FAILED | $failure"
}
finally {
  if ($createdGameData -and (Test-Path -LiteralPath $gameDataRoot)) {
    try {
      Assert-True ($gameDataRoot -eq (Join-Path $profile 'AppData\LocalLow\semiwork\Repo')) 'Synthetic cleanup path escaped its verified profile.'
      Remove-Item -LiteralPath $gameDataRoot -Recurse -Force
      if (Test-Path -LiteralPath $gameDataRoot) {
        throw 'Synthetic R.E.P.O. cleanup did not complete.'
      }
      Write-LifecycleLog "cleanup | removed synthetic game data $gameDataRoot"
    }
    catch {
      $succeeded = $false
      $cleanupFailure = $_.Exception.ToString()
      $failure = if ($failure) { "$failure`n$cleanupFailure" } else { $cleanupFailure }
      Write-LifecycleLog "CLEANUP FAILED | $cleanupFailure"
    }
  }
  $summary = [ordered]@{
    succeeded = $succeeded
    failure = $failure
    observations = @($observations)
  }
  [IO.File]::WriteAllText(
    $summaryPath,
    ($summary | ConvertTo-Json -Depth 6),
    [Text.UTF8Encoding]::new($false)
  )
}

if (-not $succeeded) { exit 1 }
Write-LifecycleLog 'PASS | installer lifecycle regression completed'
