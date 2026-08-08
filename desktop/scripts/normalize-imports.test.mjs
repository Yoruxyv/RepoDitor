import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(desktopRoot, "scripts", "normalize-imports.mjs");
const sourceRoot = path.join(desktopRoot, "src");
const featureOne = path.join(sourceRoot, "features", "__normalize_imports_one");
const featureTwo = path.join(sourceRoot, "features", "__normalize_imports_two");
const sharedTarget = path.join(sourceRoot, "shared", "__normalize_imports_target.ts");
const electronTarget = path.join(desktopRoot, "electron", "__normalize_imports_test__.cts");
const sourcePath = path.join(featureOne, "nested", "source.ts");

function runNormalizer(...arguments_) {
  return spawnSync(process.execPath, [scriptPath, ...arguments_], {
    cwd: desktopRoot,
    encoding: "utf8",
  });
}

const fixture = (includeMissing) => `
import { shared } from "../../../shared/__normalize_imports_target";
export { nearby } from "../target";
export { nearby as aliased } from "@/features/__normalize_imports_one/target";
export { outside } from "../../../../electron/__normalize_imports_test__.cts";
const loadCrossFeature = () => import("../../__normalize_imports_two/target");
${includeMissing ? 'import "./missing";' : ""}
void shared;
void loadCrossFeature;
`;

test("normalizes renderer imports monotonically and idempotently", async () => {
  await rm(featureOne, { recursive: true, force: true });
  await rm(featureTwo, { recursive: true, force: true });
  await rm(sharedTarget, { force: true });
  await rm(electronTarget, { force: true });

  try {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(featureTwo, { recursive: true });
    await mkdir(path.dirname(sharedTarget), { recursive: true });
    await writeFile(path.join(featureOne, "target.ts"), "export const nearby = true;\n");
    await writeFile(path.join(featureTwo, "target.ts"), "export const cross = true;\n");
    await writeFile(sharedTarget, "export const shared = true;\n");
    await writeFile(electronTarget, "export const outside = true;\n");
    await writeFile(sourcePath, fixture(true));

    const strictFailure = runNormalizer("--check", "--strict");
    assert.equal(strictFailure.status, 2, strictFailure.stdout + strictFailure.stderr);

    await writeFile(sourcePath, fixture(false));
    const beforePreview = await readFile(sourcePath, "utf8");
    assert.equal(runNormalizer().status, 0);
    assert.equal(await readFile(sourcePath, "utf8"), beforePreview);

    const firstFix = runNormalizer("--write", "--strict");
    assert.equal(firstFix.status, 0, firstFix.stdout + firstFix.stderr);
    const normalized = await readFile(sourcePath, "utf8");
    assert.match(normalized, /from "@\/shared\/__normalize_imports_target"/u);
    assert.match(normalized, /from "@\/features\/__normalize_imports_one\/target"/u);
    assert.match(normalized, /from "@\/features\/__normalize_imports_one\/target"/u);
    assert.match(normalized, /from "@electron\/__normalize_imports_test__"/u);
    assert.match(normalized, /import\("@\/features\/__normalize_imports_two\/target"\)/u);

    const secondFix = runNormalizer("--write", "--strict");
    assert.equal(secondFix.status, 0, secondFix.stdout + secondFix.stderr);
    assert.match(secondFix.stdout, /Imports changed\s+: 0/u);
    assert.equal(runNormalizer("--check", "--strict").status, 0);
  } finally {
    await rm(featureOne, { recursive: true, force: true });
    await rm(featureTwo, { recursive: true, force: true });
    await rm(sharedTarget, { force: true });
    await rm(electronTarget, { force: true });
  }
});
