param([int]$HostProcessId = 0)
$ErrorActionPreference = 'Stop'
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
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TauriStartupDesktop {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr desktop);
}
'@
$inputDesktop = [TauriStartupDesktop]::OpenInputDesktop(0, $false, 1)
$desktopError = if ($inputDesktop -eq [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { 0 }
if ($inputDesktop -ne [IntPtr]::Zero) { [void][TauriStartupDesktop]::CloseDesktop($inputDesktop) }
$hostProcess = if ($HostProcessId -gt 0) { Get-Process -Id $HostProcessId -ErrorAction SilentlyContinue } else { $null }
@{
    registeredRuntimeVersions = $registered
    runtimeFiles = $available
    sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    userInteractive = [Environment]::UserInteractive
    inputDesktopAvailable = ($inputDesktop -ne [IntPtr]::Zero)
    inputDesktopError = $desktopError
    hostAlive = ($null -ne $hostProcess)
    hostSessionId = if ($hostProcess) { $hostProcess.SessionId } else { $null }
    hostResponding = if ($hostProcess) { $hostProcess.Responding } else { $null }
    hostWindowPresent = if ($hostProcess) { $hostProcess.MainWindowHandle -ne [IntPtr]::Zero } else { $false }
} | ConvertTo-Json -Depth 4 -Compress
