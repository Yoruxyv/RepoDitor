param([int]$HostProcessId = 0, [string]$FixtureRoot = '', [string]$Interop)
$ErrorActionPreference = 'Stop'
$watch = [Diagnostics.Stopwatch]::StartNew()
function Write-ProbeTiming([string]$Stage) {
    [Console]::Error.WriteLine(("REPODITOR_PROBE_TIMING {0}|{1}|{2}" -f $Stage, $watch.Elapsed.TotalMilliseconds.ToString([Globalization.CultureInfo]::InvariantCulture), [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))
    [Console]::Error.Flush()
}
Write-ProbeTiming 'entry'

$runtimeKeys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$registered = @($runtimeKeys | ForEach-Object {
    if (Test-Path -LiteralPath $_) {
        $version = (Get-ItemProperty -LiteralPath $_ -Name pv).pv
        if ($version -match '^\d+\.\d+\.\d+\.\d+$') { $version }
    }
} | Select-Object -Unique)
Write-ProbeTiming 'registry_done'
$runtimeFiles = @(
    @{ scope = 'machine'; directory = (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application') },
    @{ scope = 'user'; directory = (Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application') }
)
$available = @($runtimeFiles | ForEach-Object {
    $runtimeRoot = $_
    if (Test-Path -LiteralPath $runtimeRoot.directory) {
        Get-ChildItem -LiteralPath $runtimeRoot.directory -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | ForEach-Object {
            $exe = Join-Path $_.FullName 'msedgewebview2.exe'
            if (Test-Path -LiteralPath $exe) {
                @{ scope = $runtimeRoot.scope; version = $_.Name; executableReadable = [bool](Get-Item -LiteralPath $exe).Length }
            }
        }
    }
})
Write-ProbeTiming 'runtime_files_done'
. (Join-Path $PSScriptRoot 'load-tauri-probe-interop.ps1') $Interop
Write-ProbeTiming 'interop_loaded'
$inputDesktop = [TauriStartupDesktop]::OpenInputDesktop(0, $false, 1)
$desktopError = if ($inputDesktop -eq [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { 0 }
if ($inputDesktop -ne [IntPtr]::Zero) { [void][TauriStartupDesktop]::CloseDesktop($inputDesktop) }
Write-ProbeTiming 'desktop_access_done'
$hostProcess = if ($HostProcessId -gt 0 -and [TauriStartupDesktop]::IsRunning($HostProcessId)) { Get-Process -Id $HostProcessId -ErrorAction SilentlyContinue } else { $null }
Write-ProbeTiming 'host_process_done'
$descendants = @()
if ($hostProcess) {
    # One snapshot avoids repeated WMI round trips exhausting the bounded hosted probe.
    $processes = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine)
    Write-ProbeTiming 'cim_done'
    $parents = @($HostProcessId)
    for ($depth = 0; $depth -lt 3 -and $parents.Count -gt 0; $depth++) {
        $children = @($processes | Where-Object { $_.ParentProcessId -in $parents } | Select-Object -First 32)
        $descendants += $children
        $parents = @($children | ForEach-Object { $_.ProcessId })
    }
}
Write-ProbeTiming 'descendants_done'
$webviews = @($descendants | Where-Object Name -eq 'msedgewebview2.exe' | ForEach-Object {
    $commandLine = [string]$_.CommandLine
    $debugPort = [regex]::Match($commandLine, '--remote-debugging-port=(\d+)')
    $processType = [regex]::Match($commandLine, '--type=([\w-]+)')
    @{
        pid = $_.ProcessId
        parentPid = $_.ParentProcessId
        commandLineAvailable = ($null -ne $_.CommandLine)
        kind = if ($processType.Success) { $processType.Groups[1].Value } elseif ($commandLine) { 'browser' } else { 'unavailable' }
        debuggingPort = if ($debugPort.Success) { [int]$debugPort.Groups[1].Value } else { $null }
        fixtureUserData = ($FixtureRoot -ne '' -and $commandLine.Replace('/', '\').Contains($FixtureRoot.Replace('/', '\')))
    }
})
Write-ProbeTiming 'webview_inspection_done'
$policies = @(@{ scope = 'machine'; key = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' }, @{ scope = 'user'; key = 'HKCU:\SOFTWARE\Policies\Microsoft\Edge' } | ForEach-Object {
    $policy = Get-ItemProperty -LiteralPath $_.key -ErrorAction SilentlyContinue
    @{ scope = $_.scope; remoteDebuggingAllowed = $policy.RemoteDebuggingAllowed; developerToolsAvailability = $policy.DeveloperToolsAvailability }
})
Write-ProbeTiming 'policies_done'
$window = if ($hostProcess) { $hostProcess.MainWindowHandle } else { [IntPtr]::Zero }
Write-ProbeTiming 'window_handle_done'
$responseError = 0
$responding = if (-not $hostProcess) { $null } elseif ($window -eq [IntPtr]::Zero) { $true } else { [TauriStartupDesktop]::Responds($window, [ref]$responseError) }
Write-ProbeTiming 'responding_done'
$result = @{
    registeredRuntimeVersions = $registered
    runtimeFiles = $available
    sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    userInteractive = [Environment]::UserInteractive
    inputDesktopAvailable = ($inputDesktop -ne [IntPtr]::Zero)
    inputDesktopError = $desktopError
    hostAlive = ($null -ne $hostProcess)
    hostSessionId = if ($hostProcess) { $hostProcess.SessionId } else { $null }
    hostResponding = $responding
    hostResponseTimeoutMs = 1000
    hostResponseError = $responseError
    hostWindowPresent = ($window -ne [IntPtr]::Zero)
    webviewChildren = $webviews
    debuggingPolicies = $policies
} | ConvertTo-Json -Depth 4 -Compress

Write-ProbeTiming 'json_done'
[Console]::Out.WriteLine($result)
[Console]::Out.Flush()
Write-ProbeTiming 'emitted'
