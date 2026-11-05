/** Bounded, path-redacted diagnostics for packaged native startup only. */
import { execFileSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DESKTOP_ROOT } from "./fixtureEnvironment";

export function startupText(value: string, home: string): string {
  let text = value.replaceAll("\\", "/");
  const roots = [
    [home, "<fixture>"],
    [DESKTOP_ROOT, "<desktop>"],
    [process.env["USERPROFILE"], "<user-profile>"],
    [process.env["LOCALAPPDATA"], "<local-appdata>"],
    [process.env["APPDATA"], "<appdata>"],
    [process.env["TEMP"], "<temp>"],
    [process.env["SYSTEMROOT"], "<windows>"],
  ].filter((entry): entry is [string, string] => Boolean(entry[0]));
  for (const [root, label] of roots.toSorted((a, b) => b[0].length - a[0].length)) {
    const escaped = root.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), label);
  }
  return text
    .replace(/\b(token|password|secret|authorization)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2<redacted>")
    .replace(/\b[A-Za-z]:\/[^\s"'<>]+/g, "<external-path>")
    .slice(-4096);
}

export async function reapFailedStartup(child: ChildProcess, exited: Promise<void>, home: string) {
  try {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      execFileSync(
        path.join(process.env["SYSTEMROOT"] ?? "C:\\Windows", "System32/taskkill.exe"),
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, timeout: 5000, stdio: "ignore" },
      );
    }
    if ((await Promise.race([exited, delay(5000, "timeout", { ref: false })])) === "timeout") {
      throw new Error("Preview process did not close after startup failure");
    }
    return null;
  } catch (error) {
    return startupText(String(error), home);
  }
}

export function startupEnvironment(environment: Record<string, string>, home: string) {
  return Object.fromEntries(
    [
      "APPDATA",
      "LOCALAPPDATA",
      "USERPROFILE",
      "HOME",
      "TEMP",
      "TMP",
      "SYSTEMROOT",
      "WINDIR",
      "PATH",
      "ComSpec",
      "ProgramFiles",
      "ProgramFiles(x86)",
      "ProgramData",
      "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
      "WEBVIEW2_REMOTE_DEBUGGING_PORT",
      "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
      "WEBVIEW2_USER_DATA_FOLDER",
      "WEBVIEW2_WAIT_FOR_SCRIPT_DEBUGGER",
    ].map((key) => {
      const inherited = Object.keys(process.env).find(
        (name) => name.toUpperCase() === key.toUpperCase(),
      );
      // Node's Windows spawn uses ordinal key order when environment casing collides.
      const actual = Object.keys(environment)
        .toSorted((a, b) => {
          if (a < b) return -1;
          if (a > b) return 1;
          return 0;
        })
        .find((name) => name.toUpperCase() === key.toUpperCase());
      const value = actual ? environment[actual] : undefined;
      return [
        key,
        {
          value: value === undefined ? null : startupText(value, home),
          matchesParent: value === (inherited ? process.env[inherited] : undefined),
        },
      ];
    }),
  );
}

export function windowsStartup(hostProcessId: number | undefined, home: string): unknown {
  try {
    return JSON.parse(
      execFileSync(
        path.join(
          process.env["SYSTEMROOT"] ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          path.join(DESKTOP_ROOT, "e2e/support/tauri-startup.ps1"),
          "-HostProcessId",
          String(hostProcessId ?? 0),
        ],
        { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 16_384 },
      ),
    );
  } catch (error) {
    return { probeError: startupText(String(error), home) };
  }
}
