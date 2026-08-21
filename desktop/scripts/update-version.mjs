/**
 * Transaction-like maintainer command for synchronizing RepoDitor release metadata.
 * Validates strict SemVer, updates only declared version fields, refreshes uv.lock, and
 * runs the shared alignment check without creating commits or tags.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertVersionAlignment,
  readVersionSources,
  replacePyprojectVersion,
  replacePythonVersion,
  validateVersion,
  versionPaths,
} from "./version-metadata.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepoRoot = path.resolve(desktopRoot, "..");

function writeJson(filePath, value, source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`.replaceAll("\n", eol));
}

function refreshUvLock(repoRoot) {
  const result = spawnSync("uv", ["lock"], { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`uv lock failed with exit code ${result.status ?? "unknown"}.`);
  }
}

export function updateRepositoryVersion(
  version,
  { repoRoot = defaultRepoRoot, refreshLock = refreshUvLock, log = console.log } = {},
) {
  validateVersion(version);
  const paths = versionPaths(repoRoot);
  const originals = Object.fromEntries(
    Object.entries(paths).map(([name, filePath]) => [name, readFileSync(filePath, "utf8")]),
  );
  const before = readVersionSources(repoRoot);

  const packageJson = JSON.parse(originals.packageJson);
  const packageLock = JSON.parse(originals.packageLock);
  const rootPackage = packageLock.packages?.[""];
  if (!rootPackage || typeof rootPackage !== "object") {
    throw new Error('desktop/package-lock.json is missing packages[""].');
  }

  packageJson.version = version;
  packageLock.version = version;
  rootPackage.version = version;

  log("RepoDitor version update\n");
  try {
    writeJson(paths.packageJson, packageJson, originals.packageJson);
    writeJson(paths.packageLock, packageLock, originals.packageLock);
    writeFileSync(paths.pyproject, replacePyprojectVersion(originals.pyproject, version));
    writeFileSync(paths.pythonInit, replacePythonVersion(originals.pythonInit, version));

    log(`package.json        ${before.packageJson} -> ${version}`);
    log(`package-lock.json   ${before.packageLockRoot} -> ${version}`);
    log(`pyproject.toml      ${before.pyproject} -> ${version}`);
    log(`__init__.py         ${before.pythonInit} -> ${version}`);
    log("\nRefreshing uv.lock...");
    refreshLock(repoRoot, version);
    log("Checking version alignment...");
    const aligned = assertVersionAlignment(repoRoot);
    log(`\nRepoDitor v${aligned} is aligned.`);
    return aligned;
  } catch (error) {
    for (const [name, filePath] of Object.entries(paths)) {
      writeFileSync(filePath, originals[name]);
    }
    throw error;
  }
}

function main() {
  if (process.argv.length !== 3) {
    throw new Error("Usage: npm run update:version -- MAJOR.MINOR.PATCH");
  }
  updateRepositoryVersion(process.argv[2]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`Version update failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
