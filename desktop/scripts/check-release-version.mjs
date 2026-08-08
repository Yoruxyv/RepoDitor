import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
).version;
const pyproject = readFileSync(path.join(desktopRoot, "..", "pyproject.toml"), "utf8");
const pythonVersion = /^version\s*=\s*"([^"]+)"$/m.exec(pyproject)?.[1];

if (pythonVersion !== packageVersion) {
  throw new Error(
    `Release versions differ: desktop=${packageVersion}, python=${pythonVersion ?? "missing"}`,
  );
}

if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== `v${packageVersion}`
) {
  throw new Error(
    `Release tag ${process.env.GITHUB_REF_NAME} must match v${packageVersion}`,
  );
}

console.log(`Release version ${packageVersion} is aligned.`);
