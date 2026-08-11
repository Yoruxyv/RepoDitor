import { readFileSync } from "node:fs";
import path from "node:path";

export const STRICT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

export function versionPaths(repoRoot) {
  return {
    packageJson: path.join(repoRoot, "desktop", "package.json"),
    packageLock: path.join(repoRoot, "desktop", "package-lock.json"),
    pyproject: path.join(repoRoot, "pyproject.toml"),
    pythonInit: path.join(repoRoot, "python", "repo_save_editor", "__init__.py"),
    uvLock: path.join(repoRoot, "uv.lock"),
  };
}

export function validateVersion(version) {
  if (!STRICT_VERSION.test(version)) {
    throw new Error(
      `Invalid version "${version}". Use strict MAJOR.MINOR.PATCH SemVer, for example 0.1.2.`,
    );
  }
  return version;
}

function uniqueVersion(content, pattern, label) {
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1 || typeof matches[0]?.[1] !== "string") {
    throw new Error(`Expected exactly one ${label} version field; found ${matches.length}.`);
  }
  return matches[0][1];
}

function projectSection(content) {
  const sections = [...content.matchAll(/^\[project\][ \t]*$/gmu)];
  if (sections.length !== 1 || sections[0]?.index === undefined) {
    throw new Error(
      `Expected exactly one pyproject.toml [project] section; found ${sections.length}.`,
    );
  }
  const start = sections[0];
  const bodyStart = start.index + start[0].length;
  const nextSection = /^\[[^\r\n]+\][ \t]*$/gmu;
  nextSection.lastIndex = bodyStart;
  const next = nextSection.exec(content);
  return { bodyStart, bodyEnd: next?.index ?? content.length };
}

export function readPyprojectVersion(content) {
  const { bodyStart, bodyEnd } = projectSection(content);
  return uniqueVersion(
    content.slice(bodyStart, bodyEnd),
    /^version[ \t]*=[ \t]*"([^"]+)"[ \t]*$/gmu,
    "pyproject.toml [project]",
  );
}

export function replacePyprojectVersion(content, version) {
  const { bodyStart, bodyEnd } = projectSection(content);
  const body = content.slice(bodyStart, bodyEnd);
  readPyprojectVersion(content);
  const updated = body.replace(
    /^version[ \t]*=[ \t]*"[^"]+"[ \t]*$/mu,
    `version = "${version}"`,
  );
  return content.slice(0, bodyStart) + updated + content.slice(bodyEnd);
}

export function readPythonVersion(content) {
  return uniqueVersion(
    content,
    /^__version__[ \t]*=[ \t]*"([^"]+)"[ \t]*$/gmu,
    "Python __version__",
  );
}

export function replacePythonVersion(content, version) {
  readPythonVersion(content);
  return content.replace(
    /^__version__[ \t]*=[ \t]*"[^"]+"[ \t]*$/mu,
    `__version__ = "${version}"`,
  );
}

export function readUvLockVersion(content) {
  const blocks = content.split(/(?=^\[\[package\]\][ \t]*$)/gmu).filter((block) =>
    /^name[ \t]*=[ \t]*"repo-save-editor"[ \t]*$/mu.test(block),
  );
  if (blocks.length !== 1) {
    throw new Error(`Expected exactly one repo-save-editor package in uv.lock; found ${blocks.length}.`);
  }
  return uniqueVersion(
    blocks[0],
    /^version[ \t]*=[ \t]*"([^"]+)"[ \t]*$/gmu,
    "uv.lock package",
  );
}

export function readVersionSources(repoRoot) {
  const paths = versionPaths(repoRoot);
  const packageJson = JSON.parse(readFileSync(paths.packageJson, "utf8"));
  const packageLock = JSON.parse(readFileSync(paths.packageLock, "utf8"));
  const rootPackage = packageLock.packages?.[""];
  if (!rootPackage || typeof rootPackage !== "object") {
    throw new Error('desktop/package-lock.json is missing packages[""].');
  }

  return {
    packageJson: packageJson.version,
    packageLock: packageLock.version,
    packageLockRoot: rootPackage.version,
    pyproject: readPyprojectVersion(readFileSync(paths.pyproject, "utf8")),
    pythonInit: readPythonVersion(readFileSync(paths.pythonInit, "utf8")),
    uvLock: readUvLockVersion(readFileSync(paths.uvLock, "utf8")),
  };
}

export function assertVersionAlignment(repoRoot) {
  const versions = readVersionSources(repoRoot);
  const expected = validateVersion(versions.packageJson);
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length > 0) {
    const details = Object.entries(versions)
      .map(([source, version]) => `  ${source}: ${version ?? "missing"}`)
      .join("\n");
    throw new Error(`Release versions differ; desktop/package.json expects ${expected}:\n${details}`);
  }
  return expected;
}
