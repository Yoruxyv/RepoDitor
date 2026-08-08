import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const fixturePath = path.join(desktopRoot, "e2e", "fixtures", "save.json");
const saveId = "REPO_SAVE_2026_08_08_10_20_30";

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

async function createFixture(home: string): Promise<string> {
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
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "src") },
      stdio: "inherit",
    },
  );
  return savePath;
}

async function createGameFixture(home: string): Promise<string> {
  const gameRoot = path.join(home, "game");
  const catalogPath = path.join(
    gameRoot,
    "REPO_Data",
    "StreamingAssets",
    "aa",
    "catalog.json",
  );
  await mkdir(path.dirname(catalogPath), { recursive: true });
  const keyData = [
    "Level/Arctic/Loading Graphics/a",
    "Level/Manor/Loading Graphics/b",
    "Level/Modded Moon/Loading Graphics/c",
  ].join(" ");
  await writeFile(
    catalogPath,
    JSON.stringify({ m_KeyDataString: Buffer.from(keyData).toString("base64") }),
    "utf8",
  );
  return gameRoot;
}

async function setWindowSize(
  application: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const window = await application.browserWindow(page);
  await window.evaluate((browserWindow, size) => browserWindow.setSize(size.width, size.height), {
    width,
    height,
  });
  await expect
    .poll(async () => {
      const [actualWidth, actualHeight] = await window.evaluate((browserWindow) =>
        browserWindow.getSize(),
      );
      return (
        actualWidth >= width &&
        actualWidth <= width + 16 &&
        actualHeight >= height &&
        actualHeight <= height + 16
      );
    })
    .toBe(true);
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#workspace-panel")?.getBoundingClientRect();
    const context = document
      .querySelector<HTMLElement>("[data-testid='workspace-context']")
      ?.getBoundingClientRect();
    return {
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      panel: panel && { top: panel.top, bottom: panel.bottom, left: panel.left },
      context: context && { top: context.top, left: context.left },
    };
  });
}

test("keeps Phase 7 editor changes in memory across workspaces and supported sizes", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "repoditor-phase7-isolated-profile-"));
  let application: ElectronApplication | undefined;

  try {
    const savePath = await createFixture(home);
    const gameRoot = await createGameFixture(home);
    const sourceBefore = await readFile(savePath);
    application = await electron.launch({
      args: [".", `--user-data-dir=${path.join(home, "electron-profile")}`],
      cwd: desktopRoot,
      env: {
        ...process.env,
        APPDATA: path.join(home, "AppData", "Roaming"),
        HOME: home,
        LOCALAPPDATA: path.join(home, "AppData", "Local"),
        REPO_GAME_DIR: gameRoot,
        USERPROFILE: home,
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      },
    });
    const page = await application.firstWindow();

    await expect(page.getByRole("button", { name: /Open workspace/ })).toBeVisible();
    const boundary = await page.evaluate(() => ({
      environment: Object.keys(window.repoditor.environment).sort((left, right) =>
        left.localeCompare(right),
      ),
      players: Object.keys(window.repoditor.players).sort((left, right) =>
        left.localeCompare(right),
      ),
      upgrades: Object.keys(window.repoditor.upgrades),
      run: Object.keys(window.repoditor.run),
      maps: Object.keys(window.repoditor.maps),
      requireType: typeof window.require,
      saves: Object.keys(window.repoditor.saves).sort((left, right) =>
        left.localeCompare(right),
      ),
    }));
    expect(boundary).toEqual({
      environment: ["detect"],
      players: ["avatar", "list"],
      upgrades: ["list"],
      run: ["get"],
      maps: ["list"],
      requireType: "undefined",
      saves: ["list", "open"],
    });

    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.getByTestId("workspace")).toBeVisible();
    await expect(page.getByRole("heading", { name: "2026-08-08 10:20:30" })).toBeVisible();
    await expect(page.getByText("Save opened safely")).toBeVisible();
    await expect(page.getByText("Normal")).toBeVisible();

    await page.getByRole("tab", { name: "Players" }).click();
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByTestId("avatar-fallback")).toHaveText("B");
    const health = page.getByRole("spinbutton", { name: "Current health" });
    await health.fill("42");
    await expect(page.getByTestId("pending-health-edit")).toContainText("0 → 42");
    await expect(page.getByTestId("pending-edit-count")).toHaveText("1 pending change");

    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("42");

    await page.getByRole("tab", { name: "Upgrades" }).click();
    const strength = page.getByRole("spinbutton", { name: "Strength for Beta" });
    await strength.fill("3");
    await expect(page.getByTestId("pending-upgrade-playerUpgradeStrength")).toContainText("0 → 3");

    await page.getByRole("tab", { name: "Run" }).click();
    const currency = page.getByRole("spinbutton", { name: "Currency" });
    await currency.fill("20");
    await expect(page.getByTestId("pending-run-currency")).toContainText("12 → 20");

    await page.getByRole("tab", { name: "Maps" }).click();
    await expect(page.getByText("McJannek Station")).toBeVisible();
    await expect(page.getByText("Headman Manor")).toBeVisible();
    await expect(page.getByText("Modded Moon")).toBeVisible();

    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("3");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("20");
    await expect(page.getByTestId("pending-edit-count")).toHaveText("3 pending changes");

    for (const size of [
      { width: 1600, height: 900 },
      { width: 1200, height: 800 },
      { width: 960, height: 640 },
    ]) {
      await setWindowSize(application, page, size.width, size.height);
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await expect(page.getByRole("tab", { name: "Maps" })).toBeVisible();
      await page.getByRole("tab", { name: "Overview" }).click();
      await expect(page.getByText("Save opened safely")).toBeVisible();
      await expect(page.getByText("Normal")).toBeVisible();
      await page.getByRole("tab", { name: "Players" }).click();
      await expect(page.getByRole("button", { name: /Alpha/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
      await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("42");
      await page.getByRole("tab", { name: "Upgrades" }).click();
      await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("3");
      await page.getByRole("tab", { name: "Run" }).click();
      await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("20");
      await page.getByRole("tab", { name: "Maps" }).click();
      await expect(page.getByText("McJannek Station")).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByTestId("workspace-action-bar").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("workspace-action-bar")).toBeVisible();
    }

    await setWindowSize(application, page, 1200, 800);
    const normal = await layout(page);
    expect(normal.panel).toBeTruthy();
    expect(normal.context).toBeTruthy();
    expect(normal.context!.left).toBeGreaterThan(normal.panel!.left);

    await setWindowSize(application, page, 960, 640);
    const minimum = await layout(page);
    expect(minimum.context!.top).toBeGreaterThan(minimum.panel!.bottom);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);
  } finally {
    await application?.close();
    await rm(home, { recursive: true, force: true });
  }
});
