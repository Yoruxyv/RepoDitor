import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkReleaseVersion } from "./check-release-version.mjs";
import { updateRepositoryVersion } from "./update-version.mjs";
import {
  assertVersionAlignment,
  readVersionSources,
  validateVersion,
} from "./version-metadata.mjs";

async function createFixture(version = "0.1.1") {
  const root = await mkdtemp(path.join(os.tmpdir(), "repoditor-version-tooling-"));
  await mkdir(path.join(root, "desktop"), { recursive: true });
  await mkdir(path.join(root, "desktop", "python", "repo_save_editor"), { recursive: true });
  const native = path.join(root, "desktop", "src-tauri");
  await mkdir(native);
  await writeFile(path.join(native, "tauri.conf.json"), JSON.stringify({ version }));
  await writeFile(path.join(native, "Cargo.toml"), `[package]\nname = "repoditor-preview"\nversion = "${version}"\n[dependencies]\nexample = "0.1.1"\n`);
  await writeFile(path.join(native, "Cargo.lock"), `version = 4\n\n[[package]]\nname = "example"\nversion = "0.1.1"\n\n[[package]]\nname = "repoditor-preview"\nversion = "${version}"\n`);
  await writeFile(
    path.join(root, "desktop", "package.json"),
    `${JSON.stringify({ name: "repoditor-desktop", version }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "desktop", "package-lock.json"),
    `${JSON.stringify(
      {
        name: "repoditor-desktop",
        version,
        lockfileVersion: 3,
        packages: {
          "": { name: "repoditor-desktop", version },
          "node_modules/example": { version: "0.1.1" },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(root, "pyproject.toml"),
    `[project]\nname = "repo-save-editor"\nversion = "${version}"\n\n[tool.test]\nenabled = true\n`,
  );
  await writeFile(
    path.join(root, "desktop", "python", "repo_save_editor", "__init__.py"),
    `"""Fixture."""\n\n__version__ = "${version}"\n`,
  );
  await writeFile(
    path.join(root, "uv.lock"),
    `version = 1\n\n[[package]]\nname = "repo-save-editor"\nversion = "${version}"\nsource = { editable = "." }\n`,
  );
  return root;
}

async function withFixture(run) {
  const root = await createFixture();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepts strict release versions", () => {
  for (const version of ["0.1.2", "0.2.0", "1.0.0"]) {
    assert.equal(validateVersion(version), version);
  }
});

test("rejects malformed and v-prefixed versions", () => {
  for (const version of ["v0.1.2", "0.1", "latest", "01.2.3", "1.2.3-beta.1"]) {
    assert.throws(() => validateVersion(version), /strict MAJOR\.MINOR\.PATCH/u);
  }
});

test("synchronizes every managed source without changing dependency versions", async () => {
  await withFixture(async (root) => {
    const refreshLock = (projectRoot, version) => {
      const lockPath = path.join(projectRoot, "uv.lock");
      const lock = readFileSync(lockPath, "utf8");
      writeFileSync(lockPath, lock.replace('version = "0.1.1"', `version = "${version}"`));
    };
    updateRepositoryVersion("0.1.2", { repoRoot: root, refreshLock, log: () => undefined });

    assert.deepEqual(readVersionSources(root), {
      packageJson: "0.1.2",
      packageLock: "0.1.2",
      packageLockRoot: "0.1.2",
      tauriConfig: "0.1.2",
      cargoManifest: "0.1.2",
      cargoLock: "0.1.2",
      pyproject: "0.1.2",
      pythonInit: "0.1.2",
      uvLock: "0.1.2",
    });
    const packageLock = JSON.parse(
      await readFile(path.join(root, "desktop", "package-lock.json"), "utf8"),
    );
    assert.equal(packageLock.packages["node_modules/example"].version, "0.1.1");
    assert.match(await readFile(path.join(root, "desktop", "src-tauri", "Cargo.lock"), "utf8"), /name = "example"\nversion = "0\.1\.1"/u);
  });
});

test("release check reports each mismatched metadata source", async (context) => {
  for (const [filePath, source] of [
    ["pyproject.toml", "pyproject"],
    ["desktop/python/repo_save_editor/__init__.py", "pythonInit"],
    ["desktop/package-lock.json", "packageLock"],
    ["desktop/src-tauri/tauri.conf.json", "tauriConfig"],
    ["desktop/src-tauri/Cargo.toml", "cargoManifest"],
    ["desktop/src-tauri/Cargo.lock", "cargoLock"],
  ]) {
    await context.test(source, async () => {
      await withFixture(async (root) => {
        const file = path.join(root, filePath);
        const content = await readFile(file, "utf8");
        await writeFile(file, content.replaceAll('"0.1.1"', '"0.1.2"'));
        assert.throws(() => assertVersionAlignment(root), new RegExp(source, "u"));
      });
    });
  }
});

test("release check preserves exact Git tag validation", async () => {
  await withFixture(async (root) => {
    assert.throws(
      () => checkReleaseVersion(root, { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.1.2" }),
      /must match v0\.1\.1/u,
    );
    assert.equal(
      checkReleaseVersion(root, { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.1.1" }),
      "0.1.1",
    );
  });
});
