import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";

import {
  waitForDiscoveredSave,
  waitForGameDialogClosed,
  waitForGameRunningDialog,
  waitForGameStatus,
  waitForSafeSave,
  waitForStaleSave,
  waitForWorkspaceOrContinue,
} from "./support/waits";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "..");
const fixturePath = path.join(desktopRoot, "e2e", "fixtures", "save.json");
const metaFixturePath = path.join(desktopRoot, "e2e", "fixtures", "meta-save.json");
const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const expectedVersion = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
).version as string;

function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

async function imageNaturalWidth(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error("Expected locator to resolve to an HTMLImageElement.");
    }

    return element.naturalWidth;
  });
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
  const gameRoot = path.join(home, "SteamLibrary", "steamapps", "common", "REPO");
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
  execFileSync(
    getPythonExecutable(),
    [path.join(desktopRoot, "e2e", "helpers", "create-recharge-game-assets.py"), gameRoot],
    { cwd: repoRoot, stdio: "inherit" },
  );
  execFileSync(
    getPythonExecutable(),
    [path.join(desktopRoot, "e2e", "helpers", "create-cosmetic-game-assets.py"), gameRoot],
    {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPATH: path.join(repoRoot, "python") },
      stdio: "inherit",
    },
  );
  if (process.platform === "win32") {
    await copyFile(process.execPath, path.join(gameRoot, "REPO.exe"));
  }
  return gameRoot;
}

function crc32(data: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function syntheticPng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 224, 160, 72, 255]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function createIconFixture(home: string): Promise<string> {
  const localLow = path.join(home, "AppData", "LocalLow");
  const iconRoot = path.join(localLow, "semiwork", "Repo", "Cache", "Icons");
  const items = path.join(iconRoot, "Items");
  const cosmetics = path.join(iconRoot, "Cosmetics");
  await mkdir(items, { recursive: true });
  await mkdir(cosmetics, { recursive: true });
  await writeFile(path.join(items, "item melee inflatable hammer.png"), syntheticPng());
  await writeFile(path.join(items, "item walkietalkiebox.png"), syntheticPng());
  await writeFile(path.join(cosmetics, "e2e cosmetic object 27.png"), syntheticPng());
  return localLow;
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
  return page.evaluate(() => ({
    hasHorizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
}

test("safely writes changes with backup and stale-save protection", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "repoditor-e2e-isolated-profile-"));
  let application: ElectronApplication | undefined;
  let repoProcess: ChildProcess | undefined;

  try {
    const { savePath, metaPath } = await createFixture(home);
    const gameRoot = await createGameFixture(home);
    const localAppDataLow = await createIconFixture(home);
    const sourceBefore = await readFile(savePath);
    const metaBefore = await readFile(metaPath);
    const applicationEnvironment: Record<string, string> = {
      ...stringEnvironment(process.env),
      APPDATA: path.join(home, "AppData", "Roaming"),
      HOME: home,
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      REPO_GAME_DIR: gameRoot,
      REPODITOR_E2E: "1",
      REPODITOR_E2E_LOCAL_APP_DATA_LOW: localAppDataLow,
      REPODITOR_E2E_PROJECT_STARS: "321",
      USERPROFILE: home,
    };

    delete applicationEnvironment["VITE_DEV_SERVER_URL"];
    const launchStarted = performance.now();
    application = await electron.launch({
      args: [".", "--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
      cwd: desktopRoot,
      env: {
        ...applicationEnvironment,
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      },
    });
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
    expect(chrome.version).toBe(expectedVersion);
    expect(chrome.hasApplicationMenu).toBe(false);
    await page.bringToFront();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Alt");
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null)).toBe(false);
    await expect(page).toHaveTitle("RepoDitor");
    const appIcon = page.locator('header img[src$="icon.png"]');
    await expect(appIcon).toHaveJSProperty("complete", true);
    expect(await appIcon.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByLabel("About RepoDitor")).toContainText(`RepoDitor v${expectedVersion}`);
    await expect(page.getByRole("link", { name: "Project source" })).toHaveAttribute(
      "href",
      "https://github.com/Yoruxyv/RepoDitor",
    );
    await expect(page.getByTestId("github-stars")).toHaveText("321");
    await expect(page.getByRole("button", { name: "Theme: System" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Language: English" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Language" })).toHaveCount(0);
    await page.getByRole("button", { name: "Theme: System" }).click();
    await page.getByRole("option", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Theme: Light" }).click();
    await page.getByRole("option", { name: "System" }).click();
    await expect(page.getByRole("button", { name: "Theme: System" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);
    await page.getByRole("button", { name: "Theme: System" }).click();
    await page.getByRole("option", { name: "Light" }).click();

    await setWindowSize(application, page, 960, 640);
    await expect(page.getByTestId("github-project-link")).toBeVisible();
    await expect(page.getByTestId("github-stars")).not.toBeVisible();
    for (const check of [
      { trigger: "Language: English", option: "日本語", run: "ランセーブ", theme: "テーマ", refresh: "更新" },
      { trigger: "言語: 日本語", option: "한국어", run: "런 세이브", theme: "테마", refresh: "새로 고침" },
      { trigger: "언어: 한국어", option: "中文", run: "游戏存档", theme: "主题", refresh: "刷新" },
      { trigger: "语言: 中文", option: "Bahasa Indonesia", run: "Save Run", theme: "Tema", refresh: "Segarkan" },
      { trigger: "Bahasa: Bahasa Indonesia", option: "English", run: "Run Saves", theme: "Theme", refresh: "Refresh" },
    ]) {
      await page.getByRole("button", { name: check.trigger }).click();
      await page.getByRole("option", { name: check.option }).click();
      await expect(page.getByRole("button", { name: check.run })).toBeVisible();
      await expect(page.getByRole("button", { name: new RegExp(`^${check.theme}:`) })).toBeVisible();
      await expect(page.getByRole("button", { name: check.refresh })).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    }
    await setWindowSize(application, page, 1200, 800);

    await waitForDiscoveredSave(page);
    await expect(page.locator("details")).toHaveCount(0);
    await expect(page.getByText(savePath, { exact: true })).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const launchReadyMs = performance.now() - launchStarted;
    await page.getByRole("button", { name: "Refresh" }).hover();
    const reducedFeedback = await page.getByRole("button", { name: "Refresh" }).evaluate(
      (button) => ({
        transform: getComputedStyle(button).transform,
        transitionDuration: getComputedStyle(button).transitionDuration,
      }),
    );
    expect(
      Number.parseFloat(reducedFeedback.transitionDuration)
        / (reducedFeedback.transitionDuration.endsWith("ms") ? 1_000 : 1),
    ).toBeLessThanOrEqual(0.000_01);
    expect(reducedFeedback.transform).toBe("none");
    const boundary = await page.evaluate(() => ({
      project: Object.keys(window.repoditor.project),
      environment: Object.keys(window.repoditor.environment).sort((left, right) =>
        left.localeCompare(right),
      ),
      game: Object.keys(window.repoditor.game),
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
      project: ["metadata"],
      environment: ["detect"],
      game: ["status"],
      players: ["avatar", "list"],
      upgrades: ["list"],
      run: ["get"],
      advanced: ["get"],
      cosmetics: ["get", "write"],
      maps: ["list"],
      requireType: "undefined",
      saves: ["list", "open", "write"],
    });

    await page.getByRole("button", { name: "Cosmetics" }).click();
    await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
    await expect(page.getByText("MetaSave.es3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Run Saves" }).click();

    const openStarted = performance.now();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    const openReadyMs = performance.now() - openStarted;
    await expect(page.getByRole("heading", { name: "2026-08-08 10:20:30" })).toBeVisible();
    await expect(page.getByText("Validated locally")).toBeVisible();
    const selectedMetadata = page.getByTestId("selected-save-metadata");
    const selectedSavePath = page.getByTestId("selected-save-path");
    await expect(page.locator("details")).toHaveCount(1);
    await expect(selectedSavePath).toContainText(path.basename(savePath));
    await expect(selectedSavePath.locator("code")).not.toBeVisible();
    const metadataBeforeExpand = await selectedMetadata.boundingBox();
    await selectedSavePath.locator("summary").click();
    await expect(selectedSavePath.locator("code")).toHaveText(savePath);
    const metadataAfterExpand = await selectedMetadata.boundingBox();
    expect(metadataAfterExpand?.x).toBe(metadataBeforeExpand?.x);
    expect(metadataAfterExpand?.y).toBe(metadataBeforeExpand?.y);
    await selectedSavePath.getByRole("button", { name: "Copy Source" }).click();
    await expect(selectedSavePath.getByText("Path copied")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Edit this save" })).toBeVisible();
    await expect(page.getByText("Normal")).toBeVisible();

    await page.getByRole("button", { name: "Cosmetics" }).click();
    await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
    await expect(page.getByText("Known catalog")).toBeVisible();
    await expect(page.getByText("Saved presets")).toBeVisible();
    await expect(page.getByLabel("Search by cosmetic ID")).toHaveCount(0);
    await expect(page.getByText("Cosmetic #27")).toHaveCount(0);
    const cosmeticIcon = page.getByTestId("cosmetic-icon-27");
    await expect(cosmeticIcon.locator("img")).toHaveAttribute("loading", "lazy");
    expect(await imageNaturalWidth(cosmeticIcon.locator("img"))).toBe(0);
    await cosmeticIcon.scrollIntoViewIfNeeded();
    await expect(cosmeticIcon.locator("img")).toBeVisible();
    await expect.poll(() => imageNaturalWidth(cosmeticIcon.locator("img")))
      .toBeGreaterThan(0);
    await expect(cosmeticIcon.locator("img")).not.toHaveAttribute("src", /AppData|LocalLow|\.png/i);
    await cosmeticIcon.locator("img").evaluate((image) => {
      image.dataset.loadedBeforeFilter = "true";
    });
    await page.getByRole("combobox", { name: "Type" }).selectOption("0");
    await expect(cosmeticIcon).toBeHidden();
    await page.getByRole("combobox", { name: "Type" }).selectOption("all");
    await page.getByRole("searchbox", { name: "Search cosmetics" }).fill("missing cosmetic");
    await expect(cosmeticIcon).toBeHidden();
    await page.getByRole("searchbox", { name: "Search cosmetics" }).fill("");
    await page.getByRole("combobox", { name: "Ownership" }).selectOption("locked");
    await expect(cosmeticIcon).toBeHidden();
    await page.getByRole("combobox", { name: "Ownership" }).selectOption("all");
    await page.getByRole("combobox", { name: "Sort" }).selectOption("id-desc");
    await expect(cosmeticIcon.locator("img")).toHaveAttribute("data-loaded-before-filter", "true");
    await expect(page.getByTestId("cosmetic-icon-27-loading")).toHaveCount(0);
    await expect(page.getByTestId("cosmetic-icon-26")).toHaveAttribute(
      "data-icon-source",
      "fallback",
    );
    await expect(page.getByRole("button", { name: "Clear All Presets" })).toBeDisabled();
    await page.getByRole("button", { name: "Lock All Cosmetics", exact: true }).click();
    await expect(page.getByTestId("cosmetics-pending-edit-count")).toHaveText("1 pending change");
    await expect(page.locator("#cosmetics-pending")).toContainText("1 pending change");
    expect((await readFile(metaPath)).equals(metaBefore)).toBe(true);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);
    await page.getByRole("button", { name: "Run Saves" }).click();
    await page.getByRole("button", { name: "Cosmetics" }).click();
    await expect(cosmeticIcon.locator("img")).toHaveAttribute("data-loaded-before-filter", "true");
    await expect(page.getByTestId("cosmetic-icon-27-loading")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lock All pending" })).toBeDisabled();
    await page.getByRole("button", { name: "Revert all" }).click();
    await page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
    await expect(page.getByTestId("cosmetics-pending-edit-count")).toHaveText("1 pending change");
    await page.getByRole("button", { name: "Revert all" }).click();
    await page.getByRole("button", { name: "Lock All Cosmetics", exact: true }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await waitForSafeSave(page, "cosmetics");
    const metaBackups = (await readdir(path.dirname(metaPath)))
      .filter((name) => name.startsWith(`${path.basename(metaPath)}.bak-`));
    expect(metaBackups).toHaveLength(1);
    expect((await readFile(path.join(path.dirname(metaPath), metaBackups[0]!))).equals(metaBefore))
      .toBe(true);
    expect((await readFile(metaPath)).equals(metaBefore)).toBe(false);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);

    await page.getByRole("button", { name: "Run Saves" }).click();
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
    const hammerIcon = page.getByTestId("item-icon-Item Melee Inflatable Hammer/1");
    await expect(hammerIcon.locator("img")).toBeVisible();
    await expect.poll(() => imageNaturalWidth(hammerIcon.locator("img")))
      .toBeGreaterThan(0);
    await expect(page.getByTestId("item-icon-Item Cart Medium/1"))
      .not.toHaveAttribute("data-icon-source", "local");
    await expect(page.getByTestId("item-icon-Item WalkieTalkieBox/1"))
      .not.toHaveAttribute("data-icon-source", "local");
    const iconBoundary = await page.evaluate(async () => {
      const [advancedResult, cosmeticsResult] = await Promise.all([
        window.repoditor.advanced.get("REPO_SAVE_2026_08_08_10_20_30"),
        window.repoditor.cosmetics.get(),
      ]);
      return JSON.stringify({ advancedResult, cosmeticsResult });
    });
    expect(iconBoundary).toContain("iconToken");
    expect(iconBoundary).not.toMatch(/iconKey|AppData|LocalLow|\.png/);
    await expect(page.getByText(
      "Recharge appears only for tools RepoDitor can safely refill.",
    ))
      .toBeVisible();
    const cartGroup = page.getByTestId("item-group-Cart Medium");
    await expect(cartGroup.getByLabel("2 items")).toBeVisible();
    await expect(cartGroup.getByText(/^#\d+$/)).toHaveCount(0);
    await expect(cartGroup.getByText(/Charge|Full/)).toHaveCount(0);
    const healthPackGroup = page.getByTestId("item-group-Health Pack Medium");
    await expect(healthPackGroup.getByText(/Charge|Full/)).toHaveCount(0);
    const itemSearch = page.getByRole("searchbox", { name: "Search items" });
    await itemSearch.fill("  CART MEDIUM  ");
    await expect(page.getByText("2 matching items")).toBeVisible();
    await expect(page.getByTestId("item-group-Melee Inflatable Hammer")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear item search" }).click();
    const itemFilter = page.getByRole("combobox", { name: "Filter" });
    await itemFilter.selectOption("rechargeable");
    await expect(page.getByTestId("item-group-Melee Inflatable Hammer")).toBeVisible();
    await expect(page.getByTestId("item-group-Cart Medium")).toHaveCount(0);
    await itemFilter.selectOption("not_rechargeable");
    await expect(page.getByTestId("item-group-Cart Medium")).toBeVisible();
    await expect(page.getByTestId("item-group-Health Pack Medium")).toBeVisible();
    await expect(page.getByTestId("item-group-Melee Inflatable Hammer")).toHaveCount(0);
    await itemFilter.selectOption("upgrades");
    await expect(page.getByTestId("item-group-Upgrade Player Health")).toBeVisible();
    await expect(page.getByTestId("item-group-Cart Medium")).toHaveCount(0);
    await itemFilter.selectOption("all");
    await page.getByRole("combobox", { name: "Sort" }).selectOption("quantity-desc");
    await expect(page.getByRole("list", { name: "Item instances" }).locator(":scope > li").first())
      .toHaveAttribute("data-testid", "item-group-Cart Medium");

    const hammer = page.getByTestId("item-instance-Item Melee Inflatable Hammer/1");
    await expect(page.getByTestId("item-icon-Item Melee Inflatable Hammer/1"))
      .toHaveAttribute("data-icon-source", "local");
    await expect(hammer.getByText("Current charge: 99")).toBeVisible();
    await expect(page.getByText("Item Melee Inflatable Hammer/1", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Recharge All Tools" }).click();
    await expect(hammer.getByText("Pending: 99 → Full")).toBeVisible();
    await expect(page.getByRole("button", { name: "Recharge All Tools" })).toBeDisabled();
    await itemSearch.fill("cart");
    await expect(page.getByText(/1 pending item hidden by filter/)).toBeVisible();
    await page.getByRole("button", { name: "Clear item search" }).click();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("1 pending change");
    await expect(page.locator("#workspace-tab-pending-4")).toContainText("1 pending change");
    await expect(page.locator("#run-saves-pending")).toContainText("1 pending change");
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
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("2 pending changes");

    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");

    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByTestId("upgrades-avatar-fallback")).toHaveText("B");
    await expect(page.getByTestId("selected-player-identity")).toContainText("Beta");
    await expect(page.getByTestId("selected-player-identity")).toContainText("222");
    await expect(page.getByTestId("upgrade-icon-playerUpgradeStrength"))
      .toHaveAttribute("data-icon-source", "specific");
    await expect(page.getByText("playerUpgradeStrength", { exact: true })).toHaveCount(0);
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
    await expect(page.getByText("Arctic", { exact: true })).toHaveCount(0);
    await expect(page.getByText(path.join(gameRoot, "REPO_Data", "StreamingAssets", "aa", "catalog.json"), { exact: true }))
      .toHaveCount(0);
    await expect(page.locator("details")).toHaveCount(1);

    await setWindowSize(application, page, 960, 640);
    const reviewScrollPosition = await page.evaluate(() => window.scrollY);
    const reviewButton = page.getByRole("button", { name: "Review" });
    const reviewColors = () => reviewButton.evaluate((button) => ({
      border: getComputedStyle(button).borderColor,
      text: getComputedStyle(button).color,
    }));
    const restingReviewColors = await reviewColors();
    await reviewButton.hover();
    await expect.poll(reviewColors).not.toEqual(restingReviewColors);
    const hoveredReviewColors = await reviewColors();
    await reviewButton.click();
    await page.mouse.move(0, 0);
    await expect(reviewButton).toHaveAttribute("aria-expanded", "true");
    await expect.poll(reviewColors).toEqual(hoveredReviewColors);
    const review = page.getByTestId("workspace-review");
    await expect(review).toBeVisible();
    expect(await page.getByTestId("workspace-action-bar").evaluate(
      (actionBar, reviewId) => actionBar.contains(document.getElementById(reviewId)),
      "workspace-review",
    )).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(reviewScrollPosition);
    expect(await review.evaluate((element) => getComputedStyle(element).overflowY))
      .not.toMatch(/auto|scroll/);
    expect(await page.evaluate(() => document.documentElement.scrollHeight
      > document.documentElement.clientHeight)).toBe(true);
    expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    await expect(page.getByText("Beta · Health")).toBeVisible();
    await expect(page.getByText("Beta · Strength")).toBeVisible();
    await expect(page.getByText("Run · Currency")).toBeVisible();
    await expect(page.getByText("Melee Inflatable Hammer · Charge")).toBeVisible();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("4 pending changes");
    await page.getByRole("button", { name: "Revert all" }).click();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("No pending changes");

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
    await page.getByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1" }).click();
    const saveStarted = performance.now();
    await page.getByRole("button", { name: "Save Changes" }).click();

    await waitForSafeSave(page, "workspace");
    await expect(page.getByText(/\.bak-\d+$/)).toHaveCount(0);
    const saveReadyMs = performance.now() - saveStarted;
    const backups = (await readdir(path.dirname(savePath)))
      .filter((name) => name.startsWith(`${path.basename(savePath)}.bak-`));
    expect(backups).toHaveLength(1);
    expect((await readFile(path.join(path.dirname(savePath), backups[0]!))).equals(sourceBefore))
      .toBe(true);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(false);

    await page.getByRole("button", { name: "Change save" }).click();
    await waitForDiscoveredSave(page);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);

    await page.getByRole("tab", { name: "Players" }).click();
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");
    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("3");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("20");
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByRole("heading", { name: "Melee Inflatable Hammer", exact: true }))
      .toBeVisible();
    await expect(page.getByText(
      "Recharge appears only for tools RepoDitor can safely refill.",
    ))
      .toBeVisible();
    const refilledHammer = page.getByTestId("item-instance-Item Melee Inflatable Hammer/1");
    await expect(refilledHammer.getByText("Full")).toBeVisible();
    await expect(page.getByRole("button", { name: /Recharge .*tool/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recharge All Tools" })).toBeDisabled();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("No pending changes");

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
      await expect(page.getByText("Validated locally")).toBeVisible();
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
      await expect(page.getByRole("heading", { name: "Melee Inflatable Hammer", exact: true }))
        .toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByRole("button", { name: "Cosmetics" }).click();
      await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByRole("button", { name: "Run Saves" }).click();
      await page.getByRole("tab", { name: "Maps" }).click();
      await expect(page.getByText("McJannek Station")).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    }

    await setWindowSize(application, page, 960, 640);
    await page.getByRole("tab", { name: "Run" }).click();
    const minimumCurrency = page.getByRole("spinbutton", { name: "Currency" });
    await minimumCurrency.fill("21");
    await minimumCurrency.focus();
    const focusClearOfSurface = await minimumCurrency.evaluate((control) => {
      const surface = document.querySelector<HTMLElement>("[data-pending-surface-active='true']");
      if (!surface) return false;
      return control.getBoundingClientRect().bottom <= surface.getBoundingClientRect().top;
    });
    expect(focusClearOfSurface).toBe(true);
    expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    await page.getByRole("button", { name: "Revert all" }).click();

    await page.getByRole("button", { name: "Cosmetics" }).click();
    await page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
    replaceMetaTokens(metaPath, 8);
    const externalMetaBytes = await readFile(metaPath);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await waitForStaleSave(page, "cosmetics");
    expect((await readFile(metaPath)).equals(externalMetaBytes)).toBe(true);
    expect(
      (await readdir(path.dirname(metaPath))).filter((name) =>
        name.startsWith(`${path.basename(metaPath)}.bak-`),
      ),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "Revert all" }).click();

    await page.getByRole("button", { name: "Run Saves" }).click();
    await page.getByRole("tab", { name: "Run" }).click();
    await page.getByRole("spinbutton", { name: "Currency" }).fill("30");
    replaceFixtureCurrency(savePath, 777);
    const externalBytes = await readFile(savePath);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await waitForStaleSave(page, "workspace");
    expect((await readFile(savePath)).equals(externalBytes)).toBe(true);
    expect(
      (await readdir(path.dirname(savePath))).filter((name) =>
        name.startsWith(`${path.basename(savePath)}.bak-`),
      ),
    ).toHaveLength(1);

    if (process.platform === "win32") {
      const repoExecutable = path.join(gameRoot, "REPO.exe");
      repoProcess = spawn(repoExecutable, ["-e", "setInterval(() => {}, 1000)"], {
        cwd: gameRoot,
        stdio: "ignore",
        windowsHide: true,
      });
      await waitForGameStatus(page, "running");

      await page.getByRole("button", { name: "Save Changes" }).focus();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await waitForGameRunningDialog(page);
      const checkAgain = page.getByRole("button", { name: "Check Again" });
      const exitRepoDitor = page.getByRole("button", { name: "Exit RepoDitor" });
      await expect(checkAgain).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(exitRepoDitor).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(checkAgain).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(checkAgain).toBeFocused();
      const dialogOffset = await page.getByRole("dialog").evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return {
          horizontal: Math.abs(
            bounds.left + bounds.width / 2 - document.documentElement.clientWidth / 2,
          ),
          vertical: Math.abs(
            bounds.top + bounds.height / 2 - document.documentElement.clientHeight / 2,
          ),
        };
      });
      expect(dialogOffset.horizontal).toBeLessThanOrEqual(1);
      expect(dialogOffset.vertical).toBeLessThanOrEqual(1);

      const runBeforeBlocked = await readFile(savePath);
      const runBackupsBefore = (await readdir(path.dirname(savePath))).filter((name) =>
        name.startsWith(`${path.basename(savePath)}.bak-`),
      ).length;
      const runBlocked = await page.evaluate(async ({ id }) => {
        const opened = await window.repoditor.saves.open(id);
        if (!opened.ok) return opened;
        return window.repoditor.saves.write(id, opened.data.fingerprint, [
          { feature: "run", entity: "run", field: "currency", after: 778 },
        ]);
      }, { id: saveId });
      expect(runBlocked).toMatchObject({ ok: false, error: { code: "game_running" } });
      expect((await readFile(savePath)).equals(runBeforeBlocked)).toBe(true);
      expect((await readdir(path.dirname(savePath))).filter((name) =>
        name.startsWith(`${path.basename(savePath)}.bak-`),
      )).toHaveLength(runBackupsBefore);

      const metaBeforeBlocked = await readFile(metaPath);
      const metaBackupsBefore = (await readdir(path.dirname(metaPath))).filter((name) =>
        name.startsWith(`${path.basename(metaPath)}.bak-`),
      ).length;
      const cosmeticsBlocked = await page.evaluate(async () => {
        const opened = await window.repoditor.cosmetics.get();
        if (!opened.ok) return opened;
        return window.repoditor.cosmetics.write(opened.data.fingerprint, [
          { feature: "cosmetics", entity: "known", field: "unlockAll", after: true },
        ]);
      });
      expect(cosmeticsBlocked).toMatchObject({ ok: false, error: { code: "game_running" } });
      expect((await readFile(metaPath)).equals(metaBeforeBlocked)).toBe(true);
      expect((await readdir(path.dirname(metaPath))).filter((name) =>
        name.startsWith(`${path.basename(metaPath)}.bak-`),
      )).toHaveLength(metaBackupsBefore);

      await checkAgain.click();
      await waitForGameRunningDialog(page);

      repoProcess.kill();
      await once(repoProcess, "exit");
      repoProcess = undefined;
      await waitForGameStatus(page, "not_running");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await waitForGameDialogClosed(page);
      await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("1 pending change");
    }

    console.info(
      `Release timings (ms): launch=${launchReadyMs.toFixed(0)}, open=${openReadyMs.toFixed(0)}, save=${saveReadyMs.toFixed(0)}`,
    );
  } finally {
    if (repoProcess && repoProcess.exitCode === null) {
      repoProcess.kill();
      await once(repoProcess, "exit").catch(() => undefined);
    }
    await application?.close();
    await rm(home, { recursive: true, force: true });
  }
});
