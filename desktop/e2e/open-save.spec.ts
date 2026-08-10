import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const fixturePath = path.join(desktopRoot, "e2e", "fixtures", "save.json");
const metaFixturePath = path.join(desktopRoot, "e2e", "fixtures", "meta-save.json");
const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const packagedExecutable = process.env.REPODITOR_E2E_EXECUTABLE
  ? path.resolve(desktopRoot, process.env.REPODITOR_E2E_EXECUTABLE)
  : null;

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

async function createFixture(home: string): Promise<{ savePath: string; metaPath: string }> {
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
  const metaPath = path.join(home, "AppData", "LocalLow", "semiwork", "Repo", "MetaSave.es3");
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
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import json,sys; from pathlib import Path; from repo_save_editor.core.crypto import encrypt_save; Path(sys.argv[2]).write_bytes(encrypt_save(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))))",
      metaFixturePath,
      metaPath,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "python") },
      stdio: "inherit",
    },
  );
  return { savePath, metaPath };
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

function replaceFixtureCurrency(savePath: string, currency: number): void {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import sys; from pathlib import Path; from repo_save_editor.core.crypto import decrypt_save,encrypt_save; from repo_save_editor.services.run import set_run_stat; p=Path(sys.argv[1]); d=decrypt_save(p.read_bytes()); set_run_stat(d,'currency',int(sys.argv[2])); p.write_bytes(encrypt_save(d))",
      savePath,
      String(currency),
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "python") },
      stdio: "inherit",
    },
  );
}

function replaceMetaTokens(metaPath: string, token: number): void {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import sys; from pathlib import Path; from repo_save_editor.core.crypto import decrypt_save,encrypt_save; p=Path(sys.argv[1]); d=decrypt_save(p.read_bytes()); d['cosmeticTokens']['value']=[int(sys.argv[2])]; p.write_bytes(encrypt_save(d))",
      metaPath,
      String(token),
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "python") },
      stdio: "inherit",
    },
  );
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

test("safely writes changes with backup and stale-save protection", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "repoditor-e2e-isolated-profile-"));
  let application: ElectronApplication | undefined;

  try {
    const { savePath, metaPath } = await createFixture(home);
    const gameRoot = await createGameFixture(home);
    const sourceBefore = await readFile(savePath);
    const metaBefore = await readFile(metaPath);
    const applicationEnvironment = {
      ...process.env,
      APPDATA: path.join(home, "AppData", "Roaming"),
      HOME: home,
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      REPO_GAME_DIR: gameRoot,
      USERPROFILE: home,
    };
    delete applicationEnvironment.VITE_DEV_SERVER_URL;
    const launchStarted = performance.now();
    application = await electron.launch(
      packagedExecutable
        ? {
            executablePath: packagedExecutable,
            args: ["--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
            cwd: path.dirname(packagedExecutable),
            env: applicationEnvironment,
          }
        : {
            args: [".", "--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
            cwd: desktopRoot,
            env: {
              ...applicationEnvironment,
              VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
            },
          },
    );
    const page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      const renderer = BrowserWindow.getAllWindows()[0];
      if (!renderer || !renderer.webContents.isLoadingMainFrame()) return;
      return new Promise<void>((resolve) => {
        renderer.webContents.once("did-finish-load", () => resolve());
      });
    });

    const chrome = await application.evaluate(({ app, Menu }) => ({
      hasApplicationMenu: Menu.getApplicationMenu() !== null,
      version: app.getVersion(),
    }));
    expect(chrome.version).toBe("0.1.0");
    expect(chrome.hasApplicationMenu).toBe(false);
    await page.keyboard.press("Alt");
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null)).toBe(false);
    await expect(page).toHaveTitle("RepoDitor");
    const appIcon = page.locator('header img[src$="icon.png"]');
    await expect(appIcon).toHaveJSProperty("complete", true);
    expect(await appIcon.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByLabel("About RepoDitor")).toContainText("RepoDitor v0.1.0");
    await expect(page.getByRole("link", { name: "Project source" })).toHaveAttribute(
      "href",
      "https://github.com/Yoruxyv/RepoDitor",
    );

    await expect(page.getByRole("button", { name: /Open workspace/ })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const launchReadyMs = performance.now() - launchStarted;
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const reducedTransition = await page.getByRole("button", { name: "Refresh" }).evaluate(
      (button) => getComputedStyle(button).transitionDuration,
    );
    expect(
      Number.parseFloat(reducedTransition) / (reducedTransition.endsWith("ms") ? 1_000 : 1),
    ).toBeLessThanOrEqual(0.000_01);
    const boundary = await page.evaluate(() => ({
      environment: Object.keys(window.repoditor.environment).sort((left, right) =>
        left.localeCompare(right),
      ),
      players: Object.keys(window.repoditor.players).sort((left, right) =>
        left.localeCompare(right),
      ),
      upgrades: Object.keys(window.repoditor.upgrades),
      run: Object.keys(window.repoditor.run),
      advanced: Object.keys(window.repoditor.advanced),
      cosmetics: Object.keys(window.repoditor.cosmetics).sort((left, right) =>
        left.localeCompare(right),
      ),
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
      advanced: ["get"],
      cosmetics: ["get", "write"],
      maps: ["list"],
      requireType: "undefined",
      saves: ["list", "open", "write"],
    });

    const openStarted = performance.now();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.getByTestId("workspace")).toBeVisible();
    const openReadyMs = performance.now() - openStarted;
    await expect(page.getByRole("heading", { name: "2026-08-08 10:20:30" })).toBeVisible();
    await expect(page.getByText("Save opened safely")).toBeVisible();
    await expect(page.getByText("Normal")).toBeVisible();

    await page.getByRole("tab", { name: "Cosmetics" }).click();
    await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
    await expect(page.getByText(/Unknown\/future ID/)).toBeVisible();
    await expect(page.getByText("Removal unavailable while equipped.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark Cosmetic #27 as Locked" })).toHaveCount(0);
    await page.getByRole("button", { name: "Unlock Cosmetic #28", exact: true }).click();
    await expect(page.getByTestId("pending-edit-count")).toHaveText("1 pending change");
    expect((await readFile(metaPath)).equals(metaBefore)).toBe(true);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Cosmetics" }).click();
    await expect(page.getByRole("button", { name: "Revert Cosmetic #28 ownership", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Revert Cosmetic #28 ownership", exact: true }).click();
    await page.getByRole("button", { name: "Unlock All" }).click();
    await expect(page.getByTestId("pending-edit-count")).toHaveText("1 pending change");
    await page.getByRole("button", { name: "Revert all" }).click();
    await page.getByRole("button", { name: "Unlock Cosmetic #28", exact: true }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText(/Saved safely\. Backup:/)).toBeVisible();
    const metaBackups = (await readdir(path.dirname(metaPath)))
      .filter((name) => name.startsWith(`${path.basename(metaPath)}.bak-`));
    expect(metaBackups).toHaveLength(1);
    expect((await readFile(path.join(path.dirname(metaPath), metaBackups[0]!))).equals(metaBefore))
      .toBe(true);
    expect((await readFile(metaPath)).equals(metaBefore)).toBe(false);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);

    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
    await expect(page.getByText(
      "Only the evidence-backed Refill to Full action is writable. All unverified item mutations remain unavailable.",
    ))
      .toBeVisible();
    const hammer = page.getByRole("listitem").filter({ hasText: "Melee Inflatable Hammer" });
    await expect(hammer.getByTestId("item-icon-Item Melee Inflatable Hammer/1"))
      .toHaveAttribute("data-icon-source", "specific");
    await expect(hammer.getByText("99")).toBeVisible();
    await hammer.getByText("Show save key").click();
    await expect(hammer.getByText("Item Melee Inflatable Hammer/1")).toBeVisible();
    await hammer.getByRole("button", { name: "Refill Melee Inflatable Hammer #1 to full" })
      .click();
    await expect(hammer.getByText("Pending: 99 → Full / Default")).toBeVisible();
    await expect(page.getByTestId("pending-edit-count")).toHaveText("1 pending change");
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);

    await page.getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Players" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByTestId("avatar-fallback")).toHaveText("B");
    const health = page.getByRole("spinbutton", { name: "Current health" });
    await health.focus();
    expect(await health.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      "solid",
    );
    await expect(page.getByLabel("Maximum health 100")).toBeVisible();
    await page.getByRole("button", { name: "Heal to Full" }).click();
    await expect(health).toHaveValue("100");
    await expect(page.getByRole("button", { name: "Heal to Full" })).toBeDisabled();
    await expect(page.getByTestId("pending-health-edit")).toContainText("0 → 100");
    await expect(page.getByTestId("pending-edit-count")).toHaveText("2 pending changes");

    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");

    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByTestId("upgrade-icon-playerUpgradeStrength"))
      .toHaveAttribute("data-icon-source", "specific");
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

    await expect(page.getByText("Beta · Health")).toBeVisible();
    await expect(page.getByText("Beta · Strength")).toBeVisible();
    await expect(page.getByText("Run · Currency")).toBeVisible();
    await expect(page.getByText("Melee Inflatable Hammer #1 · Stored charge")).toBeVisible();
    await expect(page.getByTestId("pending-edit-count")).toHaveText("4 pending changes");
    await page.getByRole("button", { name: "Revert all" }).click();
    await expect(page.getByTestId("pending-edit-count")).toHaveText("No pending changes");

    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("0");
    await page.getByRole("button", { name: "Heal to Full" }).click();
    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("0");
    await page.getByRole("spinbutton", { name: "Strength for Beta" }).fill("3");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("12");
    await page.getByRole("spinbutton", { name: "Currency" }).fill("20");
    await page.getByRole("tab", { name: "Items" }).click();
    await page.getByRole("button", { name: "Refill Melee Inflatable Hammer #1 to full" }).click();
    const saveStarted = performance.now();
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page.getByText(/Saved safely\. Backup:/)).toBeVisible();
    const saveReadyMs = performance.now() - saveStarted;
    await expect(page.getByTestId("pending-edit-count")).toHaveText("No pending changes");
    const backups = (await readdir(path.dirname(savePath)))
      .filter((name) => name.startsWith(`${path.basename(savePath)}.bak-`));
    expect(backups).toHaveLength(1);
    expect((await readFile(path.join(path.dirname(savePath), backups[0]!))).equals(sourceBefore))
      .toBe(true);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(false);

    await page.getByRole("button", { name: "Change save" }).click();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.getByTestId("workspace")).toBeVisible();

    await page.getByRole("tab", { name: "Players" }).click();
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");
    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("3");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("20");
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByRole("heading", { name: "Melee Inflatable Hammer #1", exact: true }))
      .toBeVisible();
    await expect(page.getByText(
      "Only the evidence-backed Refill to Full action is writable. All unverified item mutations remain unavailable.",
    ))
      .toBeVisible();
    const refilledHammer = page.getByRole("listitem").filter({ hasText: "Melee Inflatable Hammer #1" });
    await expect(refilledHammer.getByText("Full / Default")).toBeVisible();
    await expect(page.getByRole("button", { name: /Refill .* to full/ })).toHaveCount(0);
    await expect(page.getByTestId("pending-edit-count")).toHaveText("No pending changes");

    for (const size of [
      { width: 1600, height: 900 },
      { width: 1200, height: 800 },
      { width: 960, height: 640 },
    ]) {
      await setWindowSize(application, page, size.width, size.height);
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await expect(page.getByRole("tab", { name: "Maps" })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("tab", { name: "Overview" }).click();
      await expect(page.getByText("Save opened safely")).toBeVisible();
      await expect(page.getByText("Normal")).toBeVisible();
      await page.getByRole("tab", { name: "Players" }).click();
      await expect(page.getByRole("button", { name: /Alpha/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
      await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");
      await page.getByRole("tab", { name: "Upgrades" }).click();
      await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("3");
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByRole("tab", { name: "Run" }).click();
      await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("20");
      await page.getByRole("tab", { name: "Items" }).click();
      await expect(page.getByRole("heading", { name: "Melee Inflatable Hammer #1", exact: true }))
        .toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByRole("tab", { name: "Cosmetics" }).click();
      await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
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

    await page.getByRole("tab", { name: "Cosmetics" }).click();
    await page.getByRole("button", { name: "Unlock Cosmetic #29", exact: true }).click();
    replaceMetaTokens(metaPath, 8);
    const externalMetaBytes = await readFile(metaPath);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByRole("alert")).toContainText("changed after it was opened");
    await expect(page.getByTestId("pending-edit-count")).toHaveText("1 pending change");
    expect((await readFile(metaPath)).equals(externalMetaBytes)).toBe(true);
    expect(
      (await readdir(path.dirname(metaPath))).filter((name) =>
        name.startsWith(`${path.basename(metaPath)}.bak-`),
      ),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "Revert all" }).click();

    await page.getByRole("tab", { name: "Run" }).click();
    await page.getByRole("spinbutton", { name: "Currency" }).fill("30");
    replaceFixtureCurrency(savePath, 777);
    const externalBytes = await readFile(savePath);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByRole("alert")).toContainText("changed after it was opened");
    await expect(page.getByTestId("pending-edit-count")).toHaveText("1 pending change");
    expect((await readFile(savePath)).equals(externalBytes)).toBe(true);
    expect(
      (await readdir(path.dirname(savePath))).filter((name) =>
        name.startsWith(`${path.basename(savePath)}.bak-`),
      ),
    ).toHaveLength(1);
    console.info(
      `Release timings (ms): launch=${launchReadyMs.toFixed(0)}, open=${openReadyMs.toFixed(0)}, save=${saveReadyMs.toFixed(0)}`,
    );
  } finally {
    await application?.close();
    await rm(home, { recursive: true, force: true });
  }
});
