using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Win32;

// Compiled with the production engine; child invocations stand in for NSIS in isolated fixtures.
internal static class InstallerEngineChecks
{
    private static int Main(string[] args)
    {
        if (args.Contains("/currentuser"))
        {
            File.WriteAllLines(Environment.GetEnvironmentVariable("REPODITOR_CHECK_ARGUMENTS"), args);
            return int.Parse(Environment.GetEnvironmentVariable("REPODITOR_CHECK_EXIT_CODE"));
        }
        try
        {
            RunAsync().GetAwaiter().GetResult();
            Console.WriteLine("PASS: native stages, engine failures, install postconditions, removal handoff, and arguments");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }

    private static async Task RunAsync()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var enginePath = Path.Combine(root, "InstallerEngineChecks.exe");
        var installPath = Path.Combine(root, "Selected location", "RepoDitor");
        var argumentPath = Path.Combine(root, "child-arguments.txt");
        var registryPath = "Software\\RepoDitorInstallerChecks-" + Guid.NewGuid().ToString("N");
        Environment.SetEnvironmentVariable("REPODITOR_CHECK_ARGUMENTS", argumentPath);
        Environment.SetEnvironmentVariable("REPODITOR_CHECK_EXIT_CODE", "0");
        var stages = new List<InstallerState>();
        var options = Arguments.Parse(new[] {
            "--engine", enginePath, "--registry-key", registryPath, "--updated", "true"
        });
        try
        {
            using (var engine = new InstallerEngine(options, stages.Add))
            {
                await ExpectFailureAsync(engine, installPath);
                Check(stages.SequenceEqual(new[] {
                    InstallerState.Preparing, InstallerState.Installing, InstallerState.Finalizing
                }), "Stages must follow real launch and exit, even when postconditions fail.");
                var childArguments = File.ReadAllLines(argumentPath);
                Check(childArguments.Take(3).SequenceEqual(new[] { "/currentuser", "/S", "--updated" }) &&
                    string.Join(" ", childArguments.Skip(3)) == "/D=" + installPath,
                    "Scope, silent, update and selected path arguments changed.");

                using (var key = Registry.CurrentUser.CreateSubKey(registryPath))
                {
                    key.SetValue("InstallLocation", installPath);
                }
                await ExpectFailureAsync(engine, installPath);
                foreach (var relative in new[] {
                    "RepoDitor.exe", "Uninstall RepoDitor.exe", "resources\\app.asar",
                    "resources\\backend\\repoditor-backend.exe"
                })
                {
                    var file = Path.Combine(installPath, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    File.WriteAllText(file, "synthetic fixture");
                }
                stages.Clear();
                await engine.RunAsync("current", installPath);
                Check(stages.Last() == InstallerState.Finalizing && !stages.Contains(InstallerState.Success),
                    "Only the caller may report success after verified engine completion.");

                using (var key = Registry.CurrentUser.OpenSubKey(registryPath, true))
                {
                    key.SetValue("InstallLocation", root);
                }
                await ExpectFailureAsync(engine, installPath);
                Environment.SetEnvironmentVariable("REPODITOR_CHECK_EXIT_CODE", "7");
                stages.Clear();
                await ExpectFailureAsync(engine, installPath);
                Check(stages.SequenceEqual(new[] { InstallerState.Preparing, InstallerState.Installing }),
                    "A failed child must never finalize or succeed.");
            }

            Environment.SetEnvironmentVariable("REPODITOR_CHECK_EXIT_CODE", "0");
            var uninstallEnginePath = Path.Combine(root, "RemovalEntry.exe");
            File.Copy(enginePath, uninstallEnginePath);
            var removalOptions = Arguments.Parse(new[] {
                "--mode", "uninstall", "--engine", uninstallEnginePath, "--registry-key", registryPath
            });
            stages.Clear();
            var entryExited = new TaskCompletionSource<bool>();
            using (var engine = new InstallerEngine(removalOptions, delegate(InstallerState stage)
            {
                stages.Add(stage);
                if (stage == InstallerState.Finalizing)
                {
                    entryExited.SetResult(true);
                }
            }))
            {
                var removal = engine.RunAsync("current", installPath);
                await entryExited.Task;
                Check(!removal.IsCompleted && File.Exists(uninstallEnginePath),
                    "Entry-process exit must not complete removal while installed state remains.");
                // Model inner-process completion after the outer entry has exited.
                File.Delete(uninstallEnginePath);
                File.Delete(Path.Combine(installPath, "RepoDitor.exe"));
                Registry.CurrentUser.DeleteSubKey(registryPath);
                await removal;
                Check(stages.SequenceEqual(new[] {
                    InstallerState.Preparing, InstallerState.Installing, InstallerState.Finalizing
                }), "Removal must verify the handoff before returning.");
            }
        }
        finally
        {
            Registry.CurrentUser.DeleteSubKey(registryPath, false);
        }
    }

    private static async Task ExpectFailureAsync(InstallerEngine engine, string path)
    {
        try { await engine.RunAsync("current", path); }
        catch (InvalidOperationException) { return; }
        catch (FileNotFoundException) { return; }
        throw new Exception("Expected engine failure; exit zero alone must not report completion.");
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }
}
