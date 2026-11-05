import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createRunSaveFixture, DESKTOP_ROOT } from "./support/fixtureEnvironment";
import { createGameFixture } from "./support/harness";
import { close, launch, native, stageFrozenBackend } from "./support/tauriHarness";
import { startupEnvironment, startupText } from "./support/tauriStartup";

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
    expect(diagnostics.windows.probeError).toBeUndefined();
    expect(diagnostics.windows.hostAlive).toBe(true);
    for (const command of ["test_health_write", "test_health_recover"]) {
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

test("startup diagnostics bound and redact output without dumping the environment", () => {
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
