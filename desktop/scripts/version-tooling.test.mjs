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
  await mkdir(path.join(root, "python", "repo_save_editor"), { recursive: true });
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
    path.join(root, "python", "repo_save_editor", "__init__.py"),
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
    const refreshLock = (repoRoot, version) => {
      const lockPath = path.join(repoRoot, "uv.lock");
      const lock = readFileSync(lockPath, "utf8");
      writeFileSync(lockPath, lock.replace('version = "0.1.1"', `version = "${version}"`));
    };
    updateRepositoryVersion("0.1.2", { repoRoot: root, refreshLock, log: () => undefined });

    assert.deepEqual(readVersionSources(root), {
      packageJson: "0.1.2",
      packageLock: "0.1.2",
      packageLockRoot: "0.1.2",
      pyproject: "0.1.2",
      pythonInit: "0.1.2",
      uvLock: "0.1.2",
    });
    const packageLock = JSON.parse(
      await readFile(path.join(root, "desktop", "package-lock.json"), "utf8"),
    );
    assert.equal(packageLock.packages["node_modules/example"].version, "0.1.1");
  });
});

test("release check reports each mismatched metadata source", async (context) => {
  for (const [name, mutate, expected] of [
    ["pyproject", (text) => text.replace('version = "0.1.1"', 'version = "0.1.2"'), "pyproject"],
    ["Python __version__", (text) => text.replace('"0.1.1"', '"0.1.2"'), "pythonInit"],
    [
      "package lock",
      (text) => text.replace('"version": "0.1.1"', '"version": "0.1.2"'),
      "packageLock",
    ],
  ]) {
    await context.test(name, async () => {
      await withFixture(async (root) => {
        const file =
          name === "pyproject"
            ? path.join(root, "pyproject.toml")
            : name === "Python __version__"
              ? path.join(root, "python", "repo_save_editor", "__init__.py")
              : path.join(root, "desktop", "package-lock.json");
        await writeFile(file, mutate(await readFile(file, "utf8")));
        assert.throws(() => assertVersionAlignment(root), new RegExp(expected, "u"));
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
