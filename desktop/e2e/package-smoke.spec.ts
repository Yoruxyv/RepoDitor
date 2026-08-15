import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from "@playwright/test";

import {
  waitForDiscoveredSave,
  waitForWorkspaceOrContinue,
} from "./support/waits";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const fixturePath = path.join(desktopRoot, "e2e", "fixtures", "save.json");
const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const expectedVersion = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
).version as string;
const executableSetting = process.env.REPODITOR_E2E_EXECUTABLE;

if (!executableSetting) {
  throw new Error("REPODITOR_E2E_EXECUTABLE is required for the packaged smoke test.");
}

const packagedExecutable = path.resolve(desktopRoot, executableSetting);

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function getPythonExecutable(): string {
  const executable = path.join(
    repoRoot,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(executable)) {
    throw new Error(`Python test environment is missing: ${executable}`);
  }
  return executable;
}

async function createSaveFixture(home: string): Promise<void> {
  const savePath = path.join(
    home,
    "AppData",
    "LocalLow",
    "semiwork",
    "Repo",
    "saves",
    saveId,
    `${saveId}.es3`,
  );
  await mkdir(path.dirname(savePath), { recursive: true });
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import json,sys; from pathlib import Path; from repo_save_editor.core.crypto import encrypt_save; Path(sys.argv[2]).write_bytes(encrypt_save(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))))",
      fixturePath,
      savePath,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "python") },
      stdio: "inherit",
    },
  );
}

test("packaged RepoDitor launches and reaches the Python-backed workspace", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "repoditor-package-smoke-"));
  let application: ElectronApplication | undefined;

  try {
    await createSaveFixture(home);
    const localAppDataLow = path.join(home, "AppData", "LocalLow");
    const applicationEnvironment: Record<string, string> = {
      ...stringEnvironment(process.env),
      APPDATA: path.join(home, "AppData", "Roaming"),
      HOME: home,
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      REPODITOR_E2E: "1",
      REPODITOR_E2E_LOCAL_APP_DATA_LOW: localAppDataLow,
      REPODITOR_E2E_PROJECT_STARS: "321",
      USERPROFILE: home,
    };
    delete applicationEnvironment["REPO_GAME_DIR"];
    delete applicationEnvironment["VITE_DEV_SERVER_URL"];

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
      saves: Object.keys(window.repoditor.saves).sort((left, right) =>
        left.localeCompare(right),
      ),
      topLevel: Object.keys(window.repoditor).sort((left, right) =>
        left.localeCompare(right),
      ),
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

    const openStarted = performance.now();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
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

    console.info(
      `Packaged smoke timings (ms): launch=${launchReadyMs.toFixed(0)}, open=${openReadyMs.toFixed(0)}, read=${readReadyMs.toFixed(0)}`,
    );

    await application.close();
    application = undefined;
  } finally {
    await application?.close();
    await rm(home, { recursive: true, force: true });
  }
});
