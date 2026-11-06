/** Opt-in diagnostics: unavailable cases are recorded, never reported as native gate passes. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createGameFixture } from "../support/harness";
import { createRunSaveFixture, DESKTOP_ROOT } from "../support/fixtureEnvironment";
import { close, launch, native } from "../support/tauriHarness";

for (const [index, mode] of [
  "baseline",
  "normal-path",
  "prepared-profile",
  "path-and-profile",
  "additional-args-only",
  "explicit-webview-profile",
].entries()) {
  test(`comparison ${mode}`, async ({ browserName }, info) => {
    expect(browserName).toBe("chromium");
    const executable = process.env["REPODITOR_STARTUP_COMPARISON_EXECUTABLE"];
    if (!executable) throw new Error("Use the isolated startup comparison preparation");
    const home = path.resolve(
      DESKTOP_ROOT,
      process.env["REPODITOR_NATIVE_OUTPUT"]!,
      "profiles",
      `case-${index}`,
    );
    await mkdir(home, { recursive: true });
    const source = await createRunSaveFixture(home);
    const before = await readFile(source);
    await createGameFixture(home);
    const environment: Record<string, string> = {};
    if (mode === "normal-path" || mode === "path-and-profile")
      environment["PATH"] = process.env["PATH"] ?? "";
    if (mode === "prepared-profile" || mode === "path-and-profile") {
      for (const directory of ["Roaming", "Local", "Local/RepoDitorPreview"]) {
        const target = path.join(home, "AppData", directory);
        await mkdir(target, { recursive: true });
        await writeFile(path.join(target, ".startup-write-check"), "synthetic");
      }
    }
    if (mode === "additional-args-only") environment["WEBVIEW2_REMOTE_DEBUGGING_PORT"] = "";
    if (mode === "explicit-webview-profile")
      environment["WEBVIEW2_USER_DATA_FOLDER"] = path.join(
        home,
        "AppData",
        "Local",
        "RepoDitorPreview",
      );
    let ready = false;
    let failure: string | null = null;
    let app: Awaited<ReturnType<typeof launch>> | undefined;
    try {
      app = await launch(path.resolve(DESKTOP_ROOT, executable), home, environment);
    } catch (error) {
      failure = String(error);
      const captures = (await readdir(home)).filter((name) => /^startup-.*\.json$/.test(name));
      expect(captures).toHaveLength(1);
      const diagnostics = JSON.parse(await readFile(path.join(home, captures[0]), "utf8"));
      expect(diagnostics.cleanupError).toBeNull();
    }
    if (app) {
      try {
        for (const command of ["test_health_write", "test_health_recover"]) {
          expect(await native(app.page, command, { request: {} }).catch(String)).toMatch(
            /not found|not allowed|not permitted|denied/i,
          );
        }
        ready = true;
      } finally {
        await close(app.child, app.browser);
      }
    }
    expect(await readFile(source)).toEqual(before);
    await writeFile(
      info.outputPath("comparison.json"),
      JSON.stringify({ mode, ready, failure }, null, 2),
    );
    console.log(`Startup comparison ${mode}: ${ready ? "ready, read-only" : "unavailable"}`);
  });
}
