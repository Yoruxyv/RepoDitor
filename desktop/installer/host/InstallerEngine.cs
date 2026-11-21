using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Win32;

internal enum InstallerState
{
    Ready,
    Preparing,
    Installing,
    Finalizing,
    Success,
    Failure
}

// Runs the production NSIS entry point; UI state and WebView lifetime belong to the window.
internal sealed class InstallerEngine : IDisposable
{
    private readonly Arguments _options;
    private readonly ParentProcessSynchronizer _parent;
    private readonly Action<InstallerState> _onStage;
    private readonly Action<ExtractionProgress> _onProgress;
    internal string ProgressSession { get; private set; }

    internal InstallerEngine(Arguments options, Action<InstallerState> onStage,
        Action<ExtractionProgress> onProgress = null)
    {
        _options = options;
        _parent = new ParentProcessSynchronizer(options.ParentProcessId);
        _onStage = onStage;
        _onProgress = onProgress;
    }

    internal async Task RunAsync(string scope, string selectedPath)
    {
        ProgressSession = !_options.Tauri && _options.Mode != "uninstall" && _onProgress != null ? Guid.NewGuid().ToString("N") : null;
        _onStage(InstallerState.Preparing);
        if (string.IsNullOrWhiteSpace(_options.Engine) || !File.Exists(_options.Engine))
        {
            throw new FileNotFoundException("The installer engine is unavailable.", _options.Engine);
        }

        if (!_options.Tauri) await _parent.WaitAsync();
        using (var progress = ProgressSession == null ? null : new ExtractionProgressChannel(ProgressSession, _onProgress))
        {
            if (_options.Tauri && scope != "current")
            {
                throw new InvalidOperationException("This setup installs for the current user.");
            }
            var arguments = _options.Tauri ? "/S" : "/" + (scope == "all" ? "allusers" : "currentuser") + " /S";
            if (_options.Mode != "uninstall")
            {
                if (_options.Updated && !_options.Tauri)
                {
                    arguments += " --updated";
                }
                if (progress != null)
                {
                    arguments += " --repoditor-progress=" + ProgressSession +
                        " --repoditor-progress-host=" + Process.GetCurrentProcess().Id;
                }
                arguments += " /D=" + selectedPath;
            }
            else if (_options.Tauri)
            {
                arguments += " /RDREMOVE _?=" + selectedPath;
            }

            var startInfo = new ProcessStartInfo(_options.Engine, arguments);
            startInfo.WorkingDirectory = Path.GetDirectoryName(_options.Engine) ?? string.Empty;
            if (scope == "all")
            {
                startInfo.UseShellExecute = true;
                startInfo.Verb = "runas";
            }
            else
            {
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
            }

            using (var process = Process.Start(startInfo))
            {
                if (process == null)
                {
                    throw new InvalidOperationException("The installer engine did not start.");
                }
                // The process may still be checking prerequisites or removing an old version.
                // This stage means the engine is running, not that payload extraction has started.
                _onStage(InstallerState.Installing);
                if (progress != null) progress.BindEngine(process.Id);
                await Task.Run(delegate { process.WaitForExit(); });
                if (process.ExitCode != 0)
                {
                    throw new InvalidOperationException("The installer engine returned error " + process.ExitCode + ".");
                }
                // Keep the engine process handle alive while authenticating/draining
                // its pipe, so its kernel process identity cannot be recycled.
                if (progress != null) await progress.FinishAsync();
            }

            // An installed NSIS uninstaller can hand off to a temporary inner process.
            // Entry-process exit alone does not mean removal has finished.
            _onStage(InstallerState.Finalizing);
            if (_options.Mode == "uninstall")
            {
                if (!_options.Tauri)
                {
                    await WaitForUninstallCompletionAsync(scope, selectedPath);
                }
                else if (!IsUninstallComplete(scope, selectedPath))
                {
                    throw new InvalidOperationException("RepoDitor removal was incomplete.");
                }
            }
            else
            {
                VerifyInstallCompletion(scope, selectedPath);
            }
        }
    }

    private void VerifyInstallCompletion(string scope, string selectedPath)
    {
        var registry = scope == "all" ? Registry.LocalMachine : Registry.CurrentUser;
        if (string.IsNullOrWhiteSpace(_options.RegistryKey))
        {
            throw new InvalidOperationException("The installation registration is unavailable.");
        }
        using (var key = registry.OpenSubKey(_options.RegistryKey))
        {
            var registeredPath = key == null ? null : key.GetValue("InstallLocation") as string;
            if (_options.Tauri)
            {
                registeredPath = registeredPath == null ? null : registeredPath.Trim('"');
                if (key == null || (key.GetValue("DisplayVersion") as string) != _options.Version ||
                    (key.GetValue("DisplayName") as string) != "RepoDitor Desktop" ||
                    !string.Equals(key.GetValue("UninstallString") as string,
                        "\"" + Path.Combine(selectedPath, "uninstall.exe") + "\"", StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException("The Tauri installation registration is incomplete.");
                }
            }
            if (string.IsNullOrWhiteSpace(registeredPath) ||
                !string.Equals(Path.GetFullPath(registeredPath).TrimEnd('\\'),
                    Path.GetFullPath(selectedPath).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("The installation location was not registered.");
            }
        }
        var requiredFiles = _options.Tauri ? new[] {
            "RepoDitor.exe", "uninstall.exe", "backend\\repoditor-backend.exe",
            "backend\\_internal\\python313.dll", "licenses\\RepoDitor-MIT.txt",
            "licenses\\THIRD_PARTY_NOTICES.md", "licenses\\Teko-OFL.txt"
        } : new[] {
            "RepoDitor.exe", "Uninstall RepoDitor.exe", "resources\\app.asar",
            "resources\\backend\\repoditor-backend.exe"
        };
        foreach (var relativePath in requiredFiles)
        {
            if (!File.Exists(Path.Combine(selectedPath, relativePath)))
            {
                throw new FileNotFoundException("The installed payload is incomplete.", relativePath);
            }
        }
    }

    private async Task WaitForUninstallCompletionAsync(string scope, string selectedPath)
    {
        var timeout = Stopwatch.StartNew();
        while (!IsUninstallComplete(scope, selectedPath))
        {
            if (timeout.Elapsed >= TimeSpan.FromSeconds(30))
            {
                throw new InvalidOperationException("The uninstaller did not complete.");
            }
            await Task.Delay(100);
        }
    }

    private bool IsUninstallComplete(string scope, string selectedPath)
    {
        if (string.IsNullOrWhiteSpace(_options.RegistryKey))
        {
            return false;
        }

        var registry = scope == "all" ? Registry.LocalMachine : Registry.CurrentUser;
        using (var key = registry.OpenSubKey(_options.RegistryKey))
        {
            if (key != null)
            {
                return false;
            }
        }

        var installedUninstaller = _options.Tauri
            ? Path.Combine(selectedPath, "uninstall.exe")
            : _options.Engine;
        return !File.Exists(installedUninstaller) &&
            !File.Exists(Path.Combine(selectedPath, "RepoDitor.exe")) &&
            (!_options.Tauri || !File.Exists(Path.Combine(selectedPath, "backend", "repoditor-backend.exe")));
    }

    public void Dispose()
    {
        _parent.Dispose();
    }
}
