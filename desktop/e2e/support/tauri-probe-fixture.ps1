param(
    [Parameter(Mandatory)][string]$Marker,
    [ValidateSet('responsive', 'hung', 'exited', 'inaccessible')][string]$Mode
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TauriProbeFixture {
    [StructLayout(LayoutKind.Sequential)]
    public struct Message {
        public IntPtr Window;
        public uint Id;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int X, Y;
        public uint Private;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string descriptor, uint revision, out IntPtr security, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetKernelObjectSecurity(IntPtr handle, uint information, IntPtr security);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
    public static void CreateWindow() {
        // Off-screen tool window: discoverable by Process.MainWindowHandle, no taskbar entry.
        IntPtr window = CreateWindowEx(0x80, "STATIC", "RepoDitor probe fixture", 0x10CF0000, -32000, -32000, 320, 200, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (window == IntPtr.Zero || !SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, 0x57))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public static void DenyInspection() {
        IntPtr security;
        uint size;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:(D;;0x00101410;;;WD)(A;;GA;;;WD)", 1, out security, out size))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            // Only this disposable process loses inspection rights; the parent retains its handle.
            if (!SetKernelObjectSecurity(GetCurrentProcess(), 4, security))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally { LocalFree(security); }
    }
    public static void Pump() {
        Message message;
        int result;
        while ((result = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0) {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        if (result < 0) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    public static void Hang() { System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite); }
}
'@
if ($Mode -ne 'exited') { [TauriProbeFixture]::CreateWindow() }
if ($Mode -eq 'inaccessible') { [TauriProbeFixture]::DenyInspection() }
[IO.File]::WriteAllText($Marker, [string]$PID)
if ($Mode -eq 'responsive') { [TauriProbeFixture]::Pump() }
elseif ($Mode -ne 'exited') { [TauriProbeFixture]::Hang() }
