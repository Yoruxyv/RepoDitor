import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { checkArtifact, stagePreview } from "./stage-tauri.mjs";

const desktop = path.resolve(import.meta.dirname, "..");
function required(name) {
  if (!process.env[name]) throw new Error(`${name} must name a prepared Windows artifact`);
  return path.resolve(desktop, process.env[name]);
}
const host = required("REPODITOR_ARTIFACT_HOST");
const synthetic = required("REPODITOR_ARTIFACT_SYNTHETIC_HOST");
const backend = required("REPODITOR_ARTIFACT_BACKEND");
const fault = required("REPODITOR_ARTIFACT_FAULT_BACKEND");
const root = path.resolve(
  desktop,
  process.env.REPODITOR_ARTIFACT_OUTPUT ?? "build/tauri-safety/artifact-tests",
);
await mkdir(root, { recursive: true });

test("normal host and production frozen entry point are admitted", async () => {
  const checked = await checkArtifact(host, backend);
  assert.equal(checked.authority, "read-only");
  assert.equal(
    checked.hostSha256,
    createHash("sha256")
      .update(await readFile(host))
      .digest("hex"),
  );
});

test("synthetic features cannot be staged and previous output survives", async () => {
  const output = await mkdtemp(path.join(root, "rejected-"));
  await writeFile(path.join(output, "sentinel"), "existing artifact evidence");
  await assert.rejects(stagePreview(synthetic, backend, output), /host authority cannot be staged/);
  assert.equal(await readFile(path.join(output, "sentinel"), "utf8"), "existing artifact evidence");
});

test("unmarked hosts fail closed without executing the executable", async () => {
  await assert.rejects(
    checkArtifact(process.execPath, backend),
    /Missing Tauri authority resource/,
  );
});

test("development-mode hosts cannot be staged", async () => {
  await assert.rejects(
    checkArtifact(path.join(desktop, "src-tauri/target/debug/repoditor-preview.exe"), backend),
    /host authority cannot be staged/,
  );
});

test("fault-injection backend cannot enter an ordinary artifact", async () => {
  await assert.rejects(checkArtifact(host, fault), /Unexpected frozen startup scripts/);
});

test("output paths outside build are rejected before staging", async () => {
  await assert.rejects(
    stagePreview(host, backend, path.join(desktop, "release")),
    /Invalid preview output/,
  );
});

test("verified bytes, production backend and licenses are published together", async () => {
  const home = await mkdtemp(path.join(root, "accepted-"));
  const output = path.join(home, "portable");
  await stagePreview(host, backend, output);
  const receipt = JSON.parse(await readFile(path.join(output, "artifact-check.json"), "utf8"));
  assert.equal(receipt.authority, "read-only");
  assert.equal(
    receipt.hostSha256,
    createHash("sha256")
      .update(await readFile(path.join(output, "repoditor-preview.exe")))
      .digest("hex"),
  );
  assert.equal(
    (await readFile(path.join(output, "licenses/RepoDitor-MIT.txt"), "utf8")).includes("MIT"),
    true,
  );
  assert.equal(
    (await checkArtifact(path.join(output, "repoditor-preview.exe"), path.join(output, "backend")))
      .authority,
    "read-only",
  );
});
