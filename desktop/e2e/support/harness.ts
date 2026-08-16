import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

import {
  DESKTOP_ROOT,
  REPO_ROOT,
  createMetaSaveFixture,
  createRunSaveFixture,
  getPythonExecutable,
  isolatedApplicationEnvironment,
} from "./fixtureEnvironment";

export interface SourceE2eHarness {
  readonly application: ElectronApplication;
  readonly page: Page;
  readonly savePath: string;
  readonly metaPath: string;
  readonly gameRoot: string;
  readonly sourceBefore: Buffer;
  readonly metaBefore: Buffer;
  readonly launchStarted: number;
  dispose(): Promise<void>;
}

async function createGameFixture(home: string): Promise<string> {
  const gameRoot = path.join(home, "SteamLibrary", "steamapps", "common", "RepoDitor E2E Install");
  const catalogPath = path.join(gameRoot, "REPO_Data", "StreamingAssets", "aa", "catalog.json");
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
    [
      path.join(DESKTOP_ROOT, "e2e", "fixture_generators", "create-recharge-game-assets.py"),
      gameRoot,
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  execFileSync(
    getPythonExecutable(),
    [
      path.join(DESKTOP_ROOT, "e2e", "fixture_generators", "create-cosmetic-game-assets.py"),
      gameRoot,
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: path.join(REPO_ROOT, "python") },
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

async function cleanup(application: ElectronApplication | undefined, home: string): Promise<void> {
  await application?.close();
  await rm(home, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

export async function launchSourceE2eHarness(): Promise<SourceE2eHarness> {
  const home = await mkdtemp(path.join(os.tmpdir(), "repoditor-e2e-isolated-profile-"));
  let application: ElectronApplication | undefined;

  try {
    const savePath = await createRunSaveFixture(home);
    const metaPath = createMetaSaveFixture(home);
    const gameRoot = await createGameFixture(home);
    const localAppDataLow = await createIconFixture(home);
    const sourceBefore = await readFile(savePath);
    const metaBefore = await readFile(metaPath);
    const applicationEnvironment = isolatedApplicationEnvironment(home, localAppDataLow);
    applicationEnvironment["REPODITOR_E2E_STEAM_ROOT"] = path.resolve(gameRoot, "..", "..", "..");

    const launchStarted = performance.now();
    application = await electron.launch({
      args: [".", "--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
      cwd: DESKTOP_ROOT,
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

    let disposed = false;
    return {
      application,
      page,
      savePath,
      metaPath,
      gameRoot,
      sourceBefore,
      metaBefore,
      launchStarted,
      async dispose(): Promise<void> {
        if (disposed) return;
        disposed = true;
        await cleanup(application, home);
      },
    };
  } catch (error) {
    await cleanup(application, home);
    throw error;
  }
}
