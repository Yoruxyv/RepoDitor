using System;
using System.Diagnostics;
using System.IO;

internal static class InstallerLog
{
    internal static void Write(string message)
    {
        Trace.WriteLine(message);
        try
        {
            File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "installer.log"),
                DateTime.UtcNow.ToString("O") + " " + message + Environment.NewLine);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
