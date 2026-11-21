using System;
using System.Collections.Generic;

internal sealed class Arguments
{
    internal readonly string Mode = "install";
    internal readonly string Engine = string.Empty;
    internal readonly string RegistryKey = string.Empty;
    internal readonly string Path = string.Empty;
    internal readonly string CurrentPath = string.Empty;
    internal readonly string AllPath = string.Empty;
    internal readonly string Scope = "current";
    internal readonly string Version = string.Empty;
    internal readonly int ParentProcessId;
    internal readonly bool Updated;
    internal readonly bool ScopeLocked;
    internal readonly bool ShowScope = true;
    internal readonly bool Cleanup;
    internal readonly bool Tauri;

    internal static Arguments Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal) || index + 1 >= args.Length)
            {
                continue;
            }

            values[args[index].Substring(2)] = args[++index];
        }

        return new Arguments(values);
    }

    private Arguments(IDictionary<string, string> values)
    {
        Mode = Get(values, "mode", Mode);
        Engine = Get(values, "engine", Engine);
        RegistryKey = Get(values, "registry-key", RegistryKey);
        Path = Get(values, "path", Path);
        CurrentPath = Get(values, "current-path", Path);
        AllPath = Get(values, "all-path", Path);
        Scope = Get(values, "scope", Scope);
        Version = Get(values, "version", Version);
        Updated = GetBool(values, "updated");
        ScopeLocked = GetBool(values, "scope-locked");
        ShowScope = !values.ContainsKey("show-scope") || GetBool(values, "show-scope");
        Cleanup = GetBool(values, "cleanup");
        Tauri = GetBool(values, "tauri");
        int.TryParse(Get(values, "parent-pid", "0"), out ParentProcessId);
    }

    private static string Get(IDictionary<string, string> values, string name, string fallback)
    {
        string value;
        return values.TryGetValue(name, out value) ? value : fallback;
    }

    private static bool GetBool(IDictionary<string, string> values, string name)
    {
        string value;
        return values.TryGetValue(name, out value) &&
            (value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase));
    }
}
