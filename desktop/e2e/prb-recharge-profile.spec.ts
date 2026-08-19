// TEMPORARY PR B PROFILING ONLY. Remove after evidence capture.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { _electron as electron, test, type ElectronApplication, type Page } from "@playwright/test";

import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  REPO_ROOT,
  createRunSaveFixture,
  getPythonExecutable,
  isolatedApplicationEnvironment,
} from "./support/fixtureEnvironment";
import { waitForDiscoveredSave } from "./support/waits";

const PROFILE_FILE = process.env.REPODITOR_RECHARGE_PROFILE_FILE;
if (!PROFILE_FILE) throw new Error("REPODITOR_RECHARGE_PROFILE_FILE is required.");

const SECOND_SAVE_ID = "REPO_SAVE_2026_08_08_10_20_31";
const RECHARGE_CHANGE = {
  feature: "advanced",
  entity: "Item Melee Inflatable Hammer/1",
  field: "refillToFull",
  after: true,
} as const;

function record(event: string, fields: Record<string, unknown> = {}): void {
  appendFileSync(
    PROFILE_FILE!,
    `${JSON.stringify({ source: "e2e", event, timestamp: Date.now() / 1000, ...fields })}\n`,
    "utf8",
  );
}

function actualSteamLibraryRoot(): string {
  const code = [
    "from repo_save_editor.services.game.discovery import discover_game_installation",
    "from repo_save_editor.services.game.installed_build import validated_installed_build",
    "r=discover_game_installation()",
    "i=r.installation",
    "b=validated_installed_build(i) if i is not None else None",
    "assert i is not None and i.steam_library_root is not None and b is not None, 'Installed R.E.P.O. build is not currently validated by RepoDitor'",
    "print(i.steam_library_root)",
  ].join("; ");
  return execFileSync(getPythonExecutable(), ["-c", code], {
    cwd: REPO_ROOT,
    env: { ...process.env, PYTHONPATH: path.join(REPO_ROOT, "python") },
    encoding: "utf8",
  }).trim();
}

function displayName(saveId: string): string {
  return saveId
    .replace("REPO_SAVE_", "")
    .replaceAll("_", "-")
    .replace(/-(\d\d)-(\d\d)-(\d\d)$/, " $1:$2:$3");
}

async function cloneSave(home: string, sourcePath: string): Promise<void> {
  const target = path.join(
    home,
    "AppData",
    "LocalLow",
    "semiwork",
    "Repo",
    "saves",
    SECOND_SAVE_ID,
    `${SECOND_SAVE_ID}.es3`,
  );
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(sourcePath, target);
}

async function openThroughUi(page: Page, saveId: string): Promise<void> {
  await page
    .getByRole("button")
    .filter({ hasText: displayName(saveId) })
    .click();
  await page.getByTestId("workspace").waitFor({ state: "visible", timeout: 60_000 });
}

async function directRecharge(page: Page, scenario: string, saveId: string): Promise<void> {
  const opened = await page.evaluate(async (id) => window.repoditor.saves.open(id), saveId);
  if (!opened.ok) throw new Error(`Could not open benchmark save: ${opened.error.message}`);

  record("scenario_start", { scenario });
  const result = await page.evaluate(
    async ({ id, fingerprint, change }) =>
      window.repoditor.saves.write(id, fingerprint, [change] as Parameters<
        typeof window.repoditor.saves.write
      >[2]),
    { id: saveId, fingerprint: opened.data.session.fingerprint, change: RECHARGE_CHANGE },
  );
  record("scenario_end", { scenario });
  if (!result.ok) throw new Error(`Recharge benchmark write failed: ${result.error.message}`);
}

async function cleanup(application: ElectronApplication | undefined, home: string): Promise<void> {
  await application?.close();
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

test("PR B primed Recharge evidence profile", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "repoditor-prb-profile-"));
  let application: ElectronApplication | undefined;
  try {
    const steamLibrary = actualSteamLibraryRoot();
    const firstSave = await createRunSaveFixture(home);
    await cloneSave(home, firstSave);

    const localAppDataLow = path.join(home, "AppData", "LocalLow");
    const env = isolatedApplicationEnvironment(home, localAppDataLow);
    env.REPODITOR_E2E_STEAM_ROOT = steamLibrary;
    env.REPODITOR_PROFILE_RECHARGE = "1";
    env.REPODITOR_RECHARGE_PROFILE_FILE = PROFILE_FILE;

    application = await electron.launch({
      args: [".", "--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
      cwd: DESKTOP_ROOT,
      env: { ...env, VITE_DEV_SERVER_URL: "http://127.0.0.1:5173" },
    });
    const page = await application.firstWindow();
    await waitForDiscoveredSave(page);

    // Opening A performs the existing authoritative Advanced discovery and primes Electron-main evidence.
    await openThroughUi(page, E2E_SAVE_ID);

    // Both writes below target only temporary fixture saves; the real game installation is read-only.
    await directRecharge(page, "recharge:primed-a", E2E_SAVE_ID);
    await directRecharge(page, "recharge:primed-b-same-app", SECOND_SAVE_ID);
  } finally {
    await cleanup(application, home);
  }
});
