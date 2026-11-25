using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class TauriStartupDesktop {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    public static bool IsRunning(uint processId) {
        // Framework process inspection enables SeDebugPrivilege on elevated runners, bypassing ACLs.
        try { System.Diagnostics.Process.LeaveDebugMode(); }
        catch (System.ComponentModel.Win32Exception error) {
            if (error.NativeErrorCode != 1300) throw; // No debug privilege in an ordinary user's token.
        }
        IntPtr handle = OpenProcess(0x00100000, false, processId);
        if (handle == IntPtr.Zero) {
            int error = Marshal.GetLastWin32Error();
            if (error == 87) return false;
            Console.Error.WriteLine("REPODITOR_PROBE_WIN32_ERROR " + error);
            throw new System.ComponentModel.Win32Exception(error);
        }
        try {
            uint status = WaitForSingleObject(handle, 0);
            if (status == 0) return false;
            if (status == 258) return true;
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally { CloseHandle(handle); }
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("kernel32.dll")]
    private static extern void SetLastError(uint error);
    // Process.Responding can wait 5000 ms, exhausting the entire subprocess deadline.
    public static bool Responds(IntPtr window, out int error) {
        UIntPtr result;
        SetLastError(0);
        bool responds = SendMessageTimeout(window, 0, UIntPtr.Zero, IntPtr.Zero, 0x22, 1000, out result) != IntPtr.Zero;
        error = responds ? 0 : Marshal.GetLastWin32Error();
        return responds;
    }
}

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
