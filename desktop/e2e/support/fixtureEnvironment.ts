/**
 * Deterministic paths, synthetic fixture generation, and isolated process environment
 * shared by source and packaged Electron E2E. Overrides redirect every game/app data
 * location into temporary test-owned directories.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PYTHON_ROOT = path.join(DESKTOP_ROOT, "python");
const REPOSITORY_ROOT = path.resolve(DESKTOP_ROOT, "..");
export const E2E_SAVE_ID = "REPO_SAVE_2026_08_08_10_20_30";
export const EXPECTED_DESKTOP_VERSION = JSON.parse(
  readFileSync(path.join(DESKTOP_ROOT, "package.json"), "utf8"),
).version as string;

const RUN_SAVE_FIXTURE_PATH = path.join(DESKTOP_ROOT, "e2e", "fixtures", "save.json");
const META_SAVE_FIXTURE_PATH = path.join(DESKTOP_ROOT, "e2e", "fixtures", "meta-save.json");

export function stringEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function getPythonExecutable(): string {
  const executable = path.join(
    REPOSITORY_ROOT,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(executable)) {
    throw new Error(`Python test environment is missing: ${executable}`);
  }
  return executable;
}

export async function stageTestExecutable(source: string, destination: string): Promise<void> {
  if (!process.env.REPODITOR_NATIVE_RUN_ID) {
    await copyFile(source, destination);
    return;
  }
  await promisify(execFile)(
    getPythonExecutable(),
    [
      "-B",
      path.join(DESKTOP_ROOT, "scripts/tauri/native_artifacts.py"),
      "copy",
      source,
      destination,
    ],
    { windowsHide: true },
  );
}

function writeEncryptedJsonFixture(sourcePath: string, targetPath: string): void {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import json,sys; from pathlib import Path; from repo_save_editor.core.crypto import encrypt_save; Path(sys.argv[2]).write_bytes(encrypt_save(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))))",
      sourcePath,
      targetPath,
    ],
    {
      cwd: PYTHON_ROOT,
      env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
      stdio: "inherit",
    },
  );
}

export async function createRunSaveFixture(home: string): Promise<string> {
  const savePath = path.join(
    home,
    "AppData",
    "LocalLow",
    "semiwork",
    "Repo",
    "saves",
    E2E_SAVE_ID,
    `${E2E_SAVE_ID}.es3`,
  );
  await mkdir(path.dirname(savePath), { recursive: true });
  writeEncryptedJsonFixture(RUN_SAVE_FIXTURE_PATH, savePath);
  return savePath;
}

export function createMetaSaveFixture(home: string): string {
  const metaPath = path.join(home, "AppData", "LocalLow", "semiwork", "Repo", "MetaSave.es3");
  writeEncryptedJsonFixture(META_SAVE_FIXTURE_PATH, metaPath);
  return metaPath;
}

export function isolatedApplicationEnvironment(
  home: string,
  localAppDataLow: string,
): Record<string, string> {
  const environment: Record<string, string> = {
    ...stringEnvironment(process.env),
    APPDATA: path.join(home, "AppData", "Roaming"),
    HOME: home,
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    REPODITOR_E2E: "1",
    REPODITOR_E2E_LOCAL_APP_DATA_LOW: localAppDataLow,
    REPODITOR_E2E_PROJECT_STARS: "321",
    USERPROFILE: home,
  };
  delete environment["REPO_GAME_DIR"];
  delete environment["VITE_DEV_SERVER_URL"];
  return environment;
}
