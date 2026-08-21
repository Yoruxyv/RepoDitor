import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";

import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  EXPECTED_DESKTOP_VERSION,
  createRunSaveFixture,
  isolatedApplicationEnvironment,
} from "./support/fixtureEnvironment";
import { createGameFixture } from "./support/harness";
import {
  waitForDiscoveredSave,
  waitForGameStatus,
  waitForWorkspaceOrContinue,
} from "./support/waits";

const saveId = E2E_SAVE_ID;
const expectedVersion = EXPECTED_DESKTOP_VERSION;
const executableSetting = process.env.REPODITOR_E2E_EXECUTABLE;

if (!executableSetting) {
  throw new Error("REPODITOR_E2E_EXECUTABLE is required for the packaged smoke test.");
}

const packagedExecutable = path.resolve(DESKTOP_ROOT, executableSetting);

test("packaged RepoDitor launches and reaches the Python-backed workspace", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "repoditor-package-smoke-"));
  let application: ElectronApplication | undefined;

  try {
    await createRunSaveFixture(home);
    const gameRoot = await createGameFixture(home);
    const localAppDataLow = path.join(home, "AppData", "LocalLow");
    const applicationEnvironment = isolatedApplicationEnvironment(home, localAppDataLow);
    applicationEnvironment["REPODITOR_E2E_STEAM_ROOT"] = path.resolve(gameRoot, "..", "..", "..");

    const launchStarted = performance.now();
    application = await electron.launch({
      executablePath: packagedExecutable,
      args: ["--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
      cwd: path.dirname(packagedExecutable),
      env: applicationEnvironment,
    });
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("RepoDitor", { timeout: 15_000 });

    const version = await application.evaluate(({ app }) => app.getVersion());
    expect(version).toBe(expectedVersion);

    const preloadBoundary = await page.evaluate(() => ({
      requireType: typeof window.require,
      saves: Object.keys(window.repoditor.saves).sort((left, right) => left.localeCompare(right)),
      topLevel: Object.keys(window.repoditor).sort((left, right) => left.localeCompare(right)),
    }));
    expect(preloadBoundary).toEqual({
      requireType: "undefined",
      saves: ["list", "open", "write"],
      topLevel: [
        "advanced",
        "assets",
        "cosmetics",
        "environment",
        "game",
        "maps",
        "players",
        "project",
        "run",
        "saves",
        "upgrades",
      ],
    });

    await waitForDiscoveredSave(page);
    const launchReadyMs = performance.now() - launchStarted;

    const environment = await page.evaluate(() => window.repoditor.environment.detect());
    expect(environment.ok).toBe(true);
    if (!environment.ok) {
      throw new Error(`Packaged environment discovery failed: ${environment.error.code}`);
    }
    expect(environment.data.saves.map((save) => save.id)).toContain(saveId);
    await waitForGameStatus(page, "not_running");

    const openStarted = performance.now();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("editor-content")).not.toHaveAttribute("inert", "");
    const openReadyMs = performance.now() - openStarted;

    const readStarted = performance.now();
    const runResult = await page.evaluate((id) => window.repoditor.run.get(id), saveId);
    expect(runResult.ok).toBe(true);
    if (!runResult.ok) {
      throw new Error(`Packaged run read failed: ${runResult.error.code}`);
    }
    expect(runResult.data.stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "currency",
          value: 12,
        }),
      ]),
    );
    const readReadyMs = performance.now() - readStarted;

    await page.getByRole("button", { name: "Change save" }).click();
    await waitForDiscoveredSave(page);
    const reopenStarted = performance.now();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    const reopenReadyMs = performance.now() - reopenStarted;

    console.info(
      `Packaged smoke timings (ms): launch=${launchReadyMs.toFixed(0)}, open=${openReadyMs.toFixed(0)}, reopen=${reopenReadyMs.toFixed(0)}, read=${readReadyMs.toFixed(0)}`,
    );

    await application.close();
    application = undefined;
  } finally {
    await application?.close();
    await rm(home, { recursive: true, force: true });
  }
});
