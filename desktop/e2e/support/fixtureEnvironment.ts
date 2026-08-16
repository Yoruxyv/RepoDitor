import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_ROOT = path.resolve(DESKTOP_ROOT, "..");
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
    REPO_ROOT,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  if (!existsSync(executable)) {
    throw new Error(`Python test environment is missing: ${executable}`);
  }
  return executable;
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
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: path.join(REPO_ROOT, "python") },
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
