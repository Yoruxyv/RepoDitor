/** Builds isolated game data for packaged desktop tests. */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DESKTOP_ROOT,
  PYTHON_ROOT,
  getPythonExecutable,
  stageTestExecutable,
} from "./fixtureEnvironment";

export async function createGameFixture(home: string, cosmeticCount = 28): Promise<string> {
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
    { cwd: PYTHON_ROOT, stdio: "inherit" },
  );
  execFileSync(
    getPythonExecutable(),
    [
      path.join(DESKTOP_ROOT, "e2e", "fixture_generators", "create-cosmetic-game-assets.py"),
      gameRoot,
      String(cosmeticCount),
    ],
    {
      cwd: PYTHON_ROOT,
      env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
      stdio: "inherit",
    },
  );
  if (process.platform === "win32") {
    await stageTestExecutable(process.execPath, path.join(gameRoot, "REPO.exe"));
  }
  return gameRoot;
}
