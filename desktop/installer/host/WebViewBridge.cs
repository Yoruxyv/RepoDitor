using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// The window owns/disposes View through its Controls collection; raw WebView access stays here.
internal sealed class WebViewBridge
{
    private const string AppOrigin = "https://repoditor-installer.local";
    private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
    private readonly WebView2 _webView = new WebView2();
    private readonly Action<string> _onCommand;
    private bool _ready;

    internal Control View { get { return _webView; } }

    internal WebViewBridge(Color background, Action<string> onCommand)
    {
        _onCommand = onCommand;
        _webView.Dock = DockStyle.Fill;
        _webView.DefaultBackgroundColor = background;
        _webView.AllowExternalDrop = false;
    }

    internal async Task InitializeAsync()
    {
        var userData = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebView2Data");
        var environment = await CoreWebView2Environment.CreateAsync(null, userData, null);
        await _webView.EnsureCoreWebView2Async(environment);
        ConfigureWebView();
    }

    private void ConfigureWebView()
    {
        var core = _webView.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args)
        {
            if (!args.Uri.StartsWith(AppOrigin + "/", StringComparison.OrdinalIgnoreCase))
            {
                args.Cancel = true;
            }
        };
        core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
        {
            args.Handled = true;
        };
        core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs args)
        {
            args.State = CoreWebView2PermissionState.Deny;
        };
        core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs args)
        {
            args.Cancel = true;
        };
        core.WebMessageReceived += OnWebMessageReceived;

        core.SetVirtualHostNameToFolderMapping(
            "repoditor-installer.local",
            AppDomain.CurrentDomain.BaseDirectory,
            CoreWebView2HostResourceAccessKind.DenyCors);
        core.Navigate(AppOrigin + "/index.html");
    }

    private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        if (!eventArgs.Source.Equals(AppOrigin + "/index.html", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        string command;
        try { command = eventArgs.TryGetWebMessageAsString(); }
        catch (ArgumentException) { return; }

        switch (command)
        {
            case "ready":
            case "choose-path":
            case "scope:current":
            case "scope:all":
            case "start":
            case "retry":
            case "launch":
            case "cancel":
            case "close":
            case "window:drag":
            case "window:minimize":
            case "window:maximize":
            case "window:close":
                if (command == "ready")
                {
                    _ready = true;
                }
                _onCommand(command);
                break;
        }
    }

    internal void Send(IDictionary<string, object> message)
    {
        if (_ready && _webView.CoreWebView2 != null)
        {
            _webView.CoreWebView2.PostWebMessageAsJson(_json.Serialize(message));
        }
    }

    internal void SendState(InstallerState state, string message)
    {
        if (!Enum.IsDefined(typeof(InstallerState), state))
        {
            throw new ArgumentOutOfRangeException("state");
        }
        Send(new Dictionary<string, object>
        {
            { "type", "state" },
            { "state", state.ToString().ToLowerInvariant() },
            { "message", message ?? string.Empty }
        });
    }
}
