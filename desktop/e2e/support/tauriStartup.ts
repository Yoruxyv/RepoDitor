/** Bounded, path-redacted diagnostics for packaged native startup only. */
import {
  execFileSync,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";
import path from "node:path";
import http from "node:http";
import { statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  const started = performance.now();
  const startedUtc = Date.now();
  let result: SpawnSyncReturns<string> | undefined;
  let diagnostics: object;
  try {
    result = spawnSync(
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
        "-FixtureRoot",
        home,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        killSignal: "SIGKILL",
        maxBuffer: 16_384,
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || "Windows startup probe failed");
    const value: unknown = JSON.parse(result.stdout);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid Windows startup probe result");
    diagnostics = value;
  } catch (error) {
    diagnostics = { probeError: startupText(String(error), home) };
  }
  const stderr = (result?.stderr ?? "").slice(0, 16_384);
  const checkpoints = stderr
    .split(/\r?\n/)
    .flatMap((line) => {
      const match =
        /^REPODITOR_PROBE_TIMING ([a-z_]{1,32})\|(\d{1,7}(?:\.\d{1,9})?)\|(\d{1,13})$/.exec(line);
      return match
        ? [{ stage: match[1], elapsedMs: Number(match[2]), utcMs: Number(match[3]) }]
        : [];
    })
    .slice(0, 32);
  const timings = {
    totalMs: performance.now() - started,
    launchToScriptMs: checkpoints.length ? checkpoints[0].utcMs - startedUtc : null,
    checkpoints,
    probeProcessId: result?.pid,
  };
  const nativeError = /^REPODITOR_PROBE_WIN32_ERROR (\d{1,10})\r?$/m.exec(stderr);
  return { ...diagnostics, probeErrorCode: nativeError ? Number(nativeError[1]) : null, timings };
}

export function startupDirectories(home: string) {
  return Object.fromEntries(
    ["Roaming", "Local", "Local/RepoDitorPreview"].map((name) => {
      const directory = path.join(home, "AppData", name);
      let isDirectory = false;
      try {
        isDirectory = statSync(directory).isDirectory();
        writeFileSync(path.join(directory, `.startup-permission-${randomUUID()}`), "synthetic", {
          flag: "wx",
        });
        return [name, { isDirectory, hostUserWriteSucceeded: true }];
      } catch {
        return [name, { isDirectory, hostUserWriteSucceeded: false }];
      }
    }),
  );
}

/** Direct loopback HTTP, independent of Playwright and inherited proxy settings. */
export function cdpEndpoint(port: number): Promise<unknown> {
  return new Promise((resolve) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/json/version", agent: false },
      (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 4096)
            request.destroy(new Error("CDP response exceeded diagnostic bound"));
        });
        response.on("error", (error) => resolve({ error: String(error) }));
        response.on("end", () => {
          try {
            const parsed = JSON.parse(body) as {
              Browser?: unknown;
              webSocketDebuggerUrl?: unknown;
            };
            resolve({
              status: response.statusCode,
              browser: typeof parsed.Browser === "string" ? parsed.Browser.slice(0, 128) : null,
              webSocketPresent: typeof parsed.webSocketDebuggerUrl === "string",
            });
          } catch {
            resolve({ status: response.statusCode, validJson: false });
          }
        });
      },
    );
    const deadline = setTimeout(
      () => request.destroy(new Error("CDP diagnostic HTTP timeout")),
      1000,
    );
    request.once("close", () => clearTimeout(deadline));
    request.on("error", (error: NodeJS.ErrnoException) =>
      resolve({ error: error.code ?? error.message }),
    );
  });
}
