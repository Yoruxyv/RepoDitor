import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertVersionAlignment } from "./version-metadata.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepoRoot = path.resolve(desktopRoot, "..");

export function checkReleaseVersion(repoRoot = defaultRepoRoot, environment = process.env) {
  const version = assertVersionAlignment(repoRoot);
  if (environment.GITHUB_REF_TYPE === "tag" && environment.GITHUB_REF_NAME !== `v${version}`) {
    throw new Error(`Release tag ${environment.GITHUB_REF_NAME} must match v${version}.`);
  }
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const version = checkReleaseVersion();
    console.log(`Release version ${version} is aligned.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
