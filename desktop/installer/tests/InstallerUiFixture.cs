using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;

// Synthetic UIA provider only: no installer engine, registry, profile or save access.
internal static class InstallerUiFixture
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 1 || !Directory.Exists(args[0])) throw new ArgumentException("Fixture directory required.");
        var root = args[0];
        var application = new Application();
        var window = new Window { Title = "RepoDitor Setup", Width = 400, Height = 180,
            ShowInTaskbar = false, ShowActivated = false };
        var panel = new StackPanel();
        var install = new Button { Content = "Install", IsEnabled = false, Height = 40 };
        panel.Children.Add(install);
        panel.Children.Add(new TextBox { Text = "synthetic-private-path", IsReadOnly = true });
        window.Content = panel;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(25) };
        timer.Tick += delegate {
            if (!File.Exists(Path.Combine(root, "enable"))) return;
            install.IsEnabled = true;
            File.WriteAllText(Path.Combine(root, "enabled"), "enabled");
            timer.Stop();
        };
        window.ContentRendered += delegate {
            File.WriteAllText(Path.Combine(root, "shown"), new WindowInteropHelper(window).Handle.ToInt64().ToString());
            timer.Start();
        };
        install.Click += delegate {
            File.WriteAllText(Path.Combine(root, "invoked"), "Install");
            window.Close();
        };
        try { application.Run(window); }
        finally { timer.Stop(); }
    }
}
