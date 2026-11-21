using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Program
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [STAThread]
    private static int Main(string[] args)
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch (EntryPointNotFoundException) { }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var options = Arguments.Parse(args);
        var exitCode = 0;
        using (var window = new InstallerWindow(options))
        {
            Application.Run(window);
            if (options.Tauri) exitCode = window.ExitCode;
        }

        if (options.Cleanup)
        {
            Cleanup.Schedule(AppDomain.CurrentDomain.BaseDirectory);
        }
        return exitCode;
    }
}
