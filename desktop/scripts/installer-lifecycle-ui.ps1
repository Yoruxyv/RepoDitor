# UI Automation probes for the isolated interactive installer lifecycle worker.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ('InstallerLifecycleDesktop' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerLifecycleDesktop {
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint id);
  [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
  [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder value, uint size, out uint needed);
  static string Name(IntPtr handle) {
    var value = new StringBuilder(256); uint needed;
    return handle != IntPtr.Zero && GetUserObjectInformation(handle, 2, value, 512, out needed) ? value.ToString() : "unavailable";
  }
  public static string WindowStation { get { return Name(GetProcessWindowStation()); } }
  public static string Desktop { get { return Name(GetThreadDesktop(GetCurrentThreadId())); } }
  public static string InputDesktop {
    get {
      var desktop = OpenInputDesktop(0, false, 1);
      if (desktop == IntPtr.Zero) return "inaccessible:" + Marshal.GetLastWin32Error();
      try { return Name(desktop); } finally { CloseDesktop(desktop); }
    }
  }
}
'@
}

function Get-InstallerAutomationContext($HostProcess) {
  return [ordered]@{
    workerPid = $PID
    workerSession = (Get-Process -Id $PID).SessionId
    hostPid = $HostProcess.Id
    hostSession = $HostProcess.SessionId
    apartment = [Threading.Thread]::CurrentThread.GetApartmentState().ToString()
    interactive = [Environment]::UserInteractive
    windowStation = [InstallerLifecycleDesktop]::WindowStation
    desktop = [InstallerLifecycleDesktop]::Desktop
    inputDesktop = [InstallerLifecycleDesktop]::InputDesktop
    hostWindow = $HostProcess.MainWindowHandle.ToInt64()
  }
}

function Get-SafeInstallerControlName([string] $Name) {
  # Unknown names can contain paths or error data; keep only fixed product labels.
  if (-not $Name) { return '' }
  if ($Name -cmatch '^(Install|Update|Uninstall|Retry|Cancel|Close|Change|Launch RepoDitor|RepoDitor Setup|RepoDitor Uninstall|RepoDitor installer|Ready to install|Ready to update|Uninstall RepoDitor\?|Current user|All users|INSTALL FOR|INSTALL LOCATION|REMOVE INSTALLATION|RepoDitor is ready|Installation failed|Uninstall finished|Uninstall failed|Chrome Legacy Window)$') {
    return $Name
  }
  return '<redacted>'
}

function Get-InstallerControlSnapshot($Window) {
  if ($null -eq $Window) { return }
  $queue = [Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(@{ element=$Window; depth=0 })
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $count = 0
  while ($queue.Count -gt 0 -and $count -lt 64) {
    $entry = $queue.Dequeue()
    $current = $entry.element.Current
    [pscustomobject]@{
      depth = $entry.depth
      name = Get-SafeInstallerControlName $current.Name
      type = $current.ControlType.ProgrammaticName
      enabled = $current.IsEnabled
      offscreen = $current.IsOffscreen
      pid = $current.ProcessId
      handle = $current.NativeWindowHandle
      framework = $current.FrameworkId
    }
    $count++
    if ($entry.depth -ge 5) { continue }
    $child = $walker.GetFirstChild($entry.element)
    while ($null -ne $child -and ($count + $queue.Count) -lt 64) {
      $queue.Enqueue(@{ element=$child; depth=($entry.depth + 1) })
      $child = $walker.GetNextSibling($child)
    }
  }
}

function Find-Button($Window, [string] $Name) {
  return $Window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  ) | Where-Object {
    $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
    $_.Current.Name -eq $Name -and $_.Current.IsEnabled
  } | Select-Object -First 1
}
