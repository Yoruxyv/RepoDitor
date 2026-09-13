using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal sealed class InstallerWindow : Form
{
    private const int WmNcLButtonDown = 0x00A1;
    private const int HtCaption = 2;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

    private readonly Arguments _options;
    private readonly WebViewBridge _bridge;
    private readonly InstallerEngine _engine;
    private string _scope;
    private string _selectedPath;
    private bool _busy;
    private InstallerState _state = InstallerState.Ready;

    internal InstallerWindow(Arguments options)
    {
        _options = options;
        _scope = options.Scope.Equals("all", StringComparison.OrdinalIgnoreCase) ? "all" : "current";
        _selectedPath = options.Path;

        Text = options.Mode == "uninstall" ? "RepoDitor Uninstall" : "RepoDitor Setup";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.None;
        BackColor = Color.FromArgb(9, 11, 18);
        ClientSize = new Size(1216, 800);
        MinimumSize = new Size(960, 640);
        KeyPreview = true;
        AutoScaleMode = AutoScaleMode.Dpi;

        var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico");
        if (File.Exists(iconPath))
        {
            Icon = new Icon(iconPath);
        }

        _bridge = new WebViewBridge(BackColor, OnInstallerCommand);
        Controls.Add(_bridge.View);
        _engine = new InstallerEngine(options, delegate(InstallerState stage) { SendState(stage, string.Empty); });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _engine.Dispose();
        }
        base.Dispose(disposing);
    }

    protected override async void OnShown(EventArgs eventArgs)
    {
        base.OnShown(eventArgs);
        try
        {
            await _bridge.InitializeAsync();
        }
        catch (Exception error)
        {
            MessageBox.Show(
                this,
                "RepoDitor Setup could not start Microsoft Edge WebView2.\n\n" + error.Message,
                Text,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }

    protected override void OnFormClosing(FormClosingEventArgs eventArgs)
    {
        if (_busy && eventArgs.CloseReason == CloseReason.UserClosing)
        {
            eventArgs.Cancel = true;
            return;
        }

        base.OnFormClosing(eventArgs);
    }

    protected override void OnKeyDown(KeyEventArgs eventArgs)
    {
        if (eventArgs.KeyCode == Keys.Escape && !_busy)
        {
            Close();
            eventArgs.Handled = true;
        }
        base.OnKeyDown(eventArgs);
    }

    private void OnInstallerCommand(string command)
    {
        if (command == "ready")
        {
            SendInitialize();
        }
        else if (command == "choose-path" && !_busy && _options.Mode != "uninstall")
        {
            ChoosePath();
        }
        else if (command == "scope:current" && !_busy && !_options.ScopeLocked)
        {
            SetScope("current", _options.CurrentPath);
        }
        else if (command == "scope:all" && !_busy && !_options.ScopeLocked)
        {
            SetScope("all", _options.AllPath);
        }
        else if ((command == "start" || command == "retry") && !_busy &&
            (_state == InstallerState.Ready || _state == InstallerState.Failure))
        {
            RunEngine();
        }
        else if ((command == "cancel" || command == "close" || command == "window:close") && !_busy)
        {
            Close();
        }
        else if (command == "launch" && !_busy && _state == InstallerState.Success && _options.Mode != "uninstall")
        {
            LaunchRepoDitor();
        }
        else if (command == "window:minimize")
        {
            WindowState = FormWindowState.Minimized;
        }
        else if (command == "window:maximize")
        {
            WindowState = WindowState == FormWindowState.Maximized
                ? FormWindowState.Normal
                : FormWindowState.Maximized;
        }
        else if (command == "window:drag" && WindowState != FormWindowState.Maximized)
        {
            ReleaseCapture();
            SendMessage(Handle, WmNcLButtonDown, new IntPtr(HtCaption), IntPtr.Zero);
        }
    }

    private void SendInitialize()
    {
        _bridge.Send(new Dictionary<string, object>
        {
            { "type", "initialize" },
            { "mode", _options.Mode },
            { "version", _options.Version },
            { "updated", _options.Updated },
            { "scope", _scope },
            { "scopeLocked", _options.ScopeLocked },
            { "showScope", _options.ShowScope },
            { "path", _selectedPath }
        });
    }

    private void SetScope(string scope, string path)
    {
        _scope = scope;
        _selectedPath = path;
        _bridge.Send(new Dictionary<string, object>
        {
            { "type", "path" },
            { "path", _selectedPath }
        });
    }

    private void ChoosePath()
    {
        using (var dialog = new FolderBrowserDialog())
        {
            dialog.Description = "Choose the parent folder for RepoDitor";
            dialog.ShowNewFolderButton = true;
            try
            {
                var parent = Directory.GetParent(_selectedPath);
                if (parent != null && parent.Exists)
                {
                    dialog.SelectedPath = parent.FullName;
                }
            }
            catch (Exception) { }

            if (dialog.ShowDialog(this) != DialogResult.OK)
            {
                return;
            }

            _selectedPath = Path.GetFullPath(Path.Combine(dialog.SelectedPath, "RepoDitor"));
            _bridge.Send(new Dictionary<string, object>
            {
                { "type", "path" },
                { "path", _selectedPath }
            });
        }
    }

    private async void RunEngine()
    {
        _busy = true;

        try
        {
            await _engine.RunAsync(_scope, _selectedPath);

            _busy = false;
            SendState(InstallerState.Success, string.Empty);
        }
        catch (Win32Exception error)
        {
            _busy = false;
            LogFailure(error);
            SendState(InstallerState.Failure, error.NativeErrorCode == 1223
                ? "Administrator access was cancelled. No changes were made."
                : FailureMessage());
        }
        catch (Exception error)
        {
            _busy = false;
            LogFailure(error);
            SendState(InstallerState.Failure, FailureMessage());
        }
    }

    private void LaunchRepoDitor()
    {
        var executable = Path.Combine(_selectedPath, "RepoDitor.exe");
        try
        {
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
            Close();
        }
        catch (Exception error)
        {
            LogFailure(error);
            SendState(InstallerState.Failure, "RepoDitor could not be launched. Close Setup and try opening the application again.");
        }
    }

    private string FailureMessage()
    {
        return _options.Mode == "uninstall"
            ? "RepoDitor could not be removed. Retry or close this window."
            : "RepoDitor could not be installed. Retry or close this window.";
    }

    private static void LogFailure(Exception error)
    {
        Trace.TraceError(error.ToString());
        try
        {
            File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "installer.log"),
                DateTime.UtcNow.ToString("O") + " " + error + Environment.NewLine);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private void SendState(InstallerState state, string message)
    {
        _state = state;
        _bridge.SendState(state, message);
    }
}
