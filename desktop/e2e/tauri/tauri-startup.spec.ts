import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createRunSaveFixture, DESKTOP_ROOT } from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import { close, launch, native, stageFrozenBackend } from "../support/tauriHarness";
import { startupEnvironment, startupText, windowsStartup } from "../support/tauriStartup";

interface ProbeResult {
  probeError?: string;
  probeErrorCode?: number | null;
  hostAlive: boolean;
  hostResponding: boolean | null;
  hostWindowPresent: boolean;
  hostResponseTimeoutMs: number;
  hostResponseError: number;
  hostSessionId: number | null;
  sessionId: number;
  inputDesktopAvailable: boolean;
  registeredRuntimeVersions: string[];
  runtimeFiles: unknown[];
  debuggingPolicies: unknown[];
  webviewChildren: unknown[];
  timings: {
    totalMs: number;
    launchToScriptMs: number | null;
    checkpoints: { stage: string; elapsedMs: number; utcMs: number }[];
    probeProcessId: number;
  };
}

async function probeFixture(home: string, mode: string) {
  const marker = path.join(home, `${mode}-ready.txt`);
  const child = spawn(
    path.join(
      process.env["SYSTEMROOT"] ?? "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(DESKTOP_ROOT, "e2e/support/tauri-probe-fixture.ps1"),
      "-Marker",
      marker,
      "-Mode",
      mode,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let spawnError = false;
  const exited = new Promise<void>((resolve) => {
    child.once("error", () => {
      spawnError = true;
      resolve();
    });
    child.once("close", () => resolve());
  });
  try {
    await expect
      .poll(async () => {
        if (spawnError) throw new Error("Probe fixture could not start");
        if (child.exitCode !== null && child.exitCode !== 0)
          throw new Error("Probe fixture exited before readiness");
        try {
          return await readFile(marker, "utf8");
        } catch {
          return "";
        }
      })
      .toBe(String(child.pid));
    if (mode === "exited") {
      await exited;
      expect(child.exitCode).toBe(0);
    }
    return { child, exited };
  } catch (error) {
    await closeProbe(child, exited);
    throw error;
  }
}

async function closeProbe(child: ChildProcess, exited: Promise<void>) {
  if (child.exitCode === null) child.kill();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Probe fixture did not exit")), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (child.pid) expect(() => process.kill(child.pid!, 0)).toThrow();
}

test("startup ordinary packaged host exposes its bridge and remains read-only", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const normal = process.env["REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"];
  const backend = process.env["REPODITOR_ARTIFACT_BACKEND"];
  if (!normal || !backend) throw new Error("Ordinary startup requires prepared normal artifacts");
  const home = info.outputPath("isolated");
  await mkdir(home, { recursive: true });
  const source = await createRunSaveFixture(home);
  const before = await readFile(source);
  await createGameFixture(home);
  const executable = path.join(home, "repoditor-preview.exe");
  await copyFile(path.resolve(DESKTOP_ROOT, normal), executable);
  await stageFrozenBackend(home, backend);
  const app = await launch(executable, home);
  try {
    const diagnostics = JSON.parse(await readFile(app.startupPath, "utf8"));
    expect(diagnostics.state).toBe("ready");
    expect(diagnostics.spawnError).toBeNull();
    expect(diagnostics.endpoint.status).toBe(200);
    expect(diagnostics.endpoint.webSocketPresent).toBe(true);
    expect(diagnostics.windows.probeError).toBeUndefined();
    expect(diagnostics.windows.hostAlive).toBe(true);
    expect(diagnostics.windows.hostWindowPresent).toBe(true);
    expect(diagnostics.windows.hostResponding).toBe(true);
    expect(diagnostics.windows.hostResponseError).toBe(0);
    expect(diagnostics.windows.hostResponseTimeoutMs).toBe(1000);
    expect(diagnostics.windows.timings.totalMs).toBeLessThan(5000);
    expect(diagnostics.windows.timings.checkpoints.at(-1).stage).toBe("emitted");
    if (process.env["REPODITOR_NATIVE_BROWSER_ARGS"] === "1") {
      expect(diagnostics.environment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.value).toBe("");
      expect(diagnostics.environment.WEBVIEW2_REMOTE_DEBUGGING_PORT.value).toBe("");
      expect(
        diagnostics.windows.webviewChildren.some(
          (child: { kind: string; debuggingPort: number | null }) =>
            child.kind === "browser" && child.debuggingPort === diagnostics.requestedCdpPort,
        ),
      ).toBe(true);
    }
    for (const command of [
      "test_health_write",
      "test_health_recover",
      "test_upgrades_write",
      "test_run_write",
    ]) {
      const denied = await native(app.page, command, { request: {} }).catch(String);
      expect(denied).toMatch(/not found|not allowed|not permitted|denied/i);
    }
    await app.page.getByRole("button", { name: /Open workspace/ }).click();
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await expect(app.page.getByRole("spinbutton")).toHaveCount(0);
    await expect(app.page.getByRole("textbox", { name: "Strength for Alpha" })).toHaveAttribute(
      "readonly",
    );
    expect(await readFile(source)).toEqual(before);
    expect(
      (await readdir(path.dirname(source))).filter((name) => /\.bak-|health-/.test(name)),
    ).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

test("startup diagnostics bound and redact output without dumping the environment", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = path.join(DESKTOP_ROOT, "build", "diagnostic-fixture");
  const redacted = startupText(
    `${home}/file token=private-secret password=another-secret C:/Users/PrivatePerson/data`,
    home,
  );
  expect(redacted).toContain("<fixture>/file");
  expect(redacted).not.toMatch(/private-secret|another-secret|PrivatePerson/);
  expect(startupText("x".repeat(100_000), home)).toHaveLength(4096);
  const environment = startupEnvironment(
    {
      APPDATA: path.join(home, "AppData"),
      Path: "parent-path",
      PATH: path.join(home, "bin"),
      SECRET_SENTINEL: "hidden",
    },
    home,
  );
  expect(JSON.stringify(environment)).not.toMatch(/SECRET_SENTINEL|hidden/);
  expect(environment["APPDATA"].value).toBe("<fixture>/AppData");
  expect(environment["PATH"].value).toBe("<fixture>/bin");
  const fixtureHome = info.outputPath("probe-fixtures");
  await mkdir(fixtureHome, { recursive: true });
  const measurements: { mode: string; sample: number; result: ProbeResult }[] = [];
  for (const mode of ["responsive", "hung", "exited", "inaccessible"]) {
    await test.step(`bounded ${mode} process inspection`, async () => {
      const fixture = await probeFixture(fixtureHome, mode);
      try {
        for (let sample = 1; sample <= 2; sample++) {
          const result = windowsStartup(fixture.child.pid, fixtureHome) as ProbeResult;
          measurements.push({ mode, sample, result });
          await writeFile(
            info.outputPath("startup-probe-state-timings.json"),
            JSON.stringify(measurements, null, 2),
          );
          expect(result.timings.totalMs).toBeLessThan(5000);
          expect(result.timings.checkpoints[0].stage).toBe("entry");
          expect(() => process.kill(result.timings.probeProcessId, 0)).toThrow();
          if (mode === "inaccessible") {
            expect(result.probeError).toBeTruthy();
            expect(result.probeErrorCode).toBe(5);
            expect(result.hostAlive).toBeUndefined();
            expect(result.timings.checkpoints.at(-1)?.stage).toBe("desktop_access_done");
          } else {
            expect(result.probeError).toBeUndefined();
            expect(result.timings.checkpoints.at(-1)?.stage).toBe("emitted");
            expect(result.hostAlive).toBe(mode !== "exited");
            expect(result.hostResponding).toBe(
              ({ responsive: true, hung: false, exited: null } as Record<string, boolean | null>)[
                mode
              ],
            );
            expect(result.hostWindowPresent).toBe(mode !== "exited");
            expect(result.hostResponseTimeoutMs).toBe(1000);
            expect(result.sessionId).toBeGreaterThanOrEqual(0);
            expect(typeof result.inputDesktopAvailable).toBe("boolean");
            expect(Array.isArray(result.registeredRuntimeVersions)).toBe(true);
            expect(Array.isArray(result.runtimeFiles)).toBe(true);
            expect(result.debuggingPolicies).toHaveLength(2);
            expect(Array.isArray(result.webviewChildren)).toBe(true);
          }
        }
      } finally {
        await closeProbe(fixture.child, fixture.exited);
      }
    });
  }
  await info.attach("probe-state-timings", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});

for (const kind of ["spawn error", "early exit", "no CDP"] as const) {
  test(`startup diagnostics preserve ${kind} without leaving a child`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const home = info.outputPath("isolated");
    await mkdir(home, { recursive: true });
    const executable = kind === "spawn error" ? path.join(home, "missing.exe") : process.execPath;
    const environment: Record<string, string> = {};
    if (kind !== "spawn error") {
      const fixture = path.join(home, "early-exit.cjs");
      const stderrMessage = JSON.stringify(home + "/fixture authorization=diagnostic-sentinel");
      const finish = kind === "no CDP" ? "setInterval(() => {}, 1000)" : "process.exitCode = 23";
      await writeFile(
        fixture,
        `process.stdout.write("x".repeat(12000)); process.stderr.write(${stderrMessage}); ${finish};`,
      );
      environment["NODE_OPTIONS"] = `--require "${fixture.replaceAll("\\", "/")}"`;
    }
    await expect(launch(executable, home, environment)).rejects.toThrow(
      /Preview (spawn failed|exited before becoming available|WebView2 did not become available)/,
    );
    const reports = (await readdir(home)).filter((name) => /^startup-.*\.json$/.test(name));
    expect(reports).toHaveLength(1);
    const report = JSON.parse(await readFile(path.join(home, reports[0]), "utf8"));
    expect(report.state).toBe("failed");
    expect(report.cleanupError).toBeNull();
    expect(report.lastCdpError).toBeTruthy();
    expect(report.endpoint.error).toBe("ECONNREFUSED");
    if (kind === "spawn error") expect(report.spawnError).toContain("ENOENT");
    else {
      if (kind === "early exit") expect(report.exitCode).toBe(23);
      else {
        expect(report.beforeCleanup.exitCode).toBeNull();
        expect(report.windows.hostAlive).toBe(true);
      }
      expect(report.stdout).toHaveLength(4096);
      expect(report.stderr).toContain("<fixture>/fixture");
      expect(report.stderr).not.toContain("diagnostic-sentinel");
    }
    if (report.pid) {
      expect(() => process.kill(report.pid, 0)).toThrow();
    }
  });
}
