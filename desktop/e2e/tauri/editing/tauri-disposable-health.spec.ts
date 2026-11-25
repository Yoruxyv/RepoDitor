import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  DESKTOP_ROOT,
  getPythonExecutable,
  PYTHON_ROOT,
  stageTestExecutable,
} from "../../support/fixtures/fixtureEnvironment";
import {
  close,
  launch,
  openRunWorkspace,
  stageFrozenBackend,
} from "../../support/harness/tauriHarness";

const build = path.join(DESKTOP_ROOT, "build");
const recovery = path.join(build, "recovery-checkpoint");

async function verifiedSnapshot() {
  const folder = process.env["REPODITOR_DISPOSABLE_HEALTH_INTAKE"] ?? "";
  if (!/^w6-d2-locallow-readonly-\d{8}-\d{6}-\d{6}$/.test(folder)) {
    throw new Error("Select an existing W6-D2 read-only intake directory by name.");
  }
  const intake = path.join(build, folder);
  const reportPath = path.join(intake, "report.json");
  if ((await realpath(reportPath)) !== reportPath) {
    throw new Error("The W6-D2 intake report must be local and free of path redirection.");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    source?: {
      copyPath?: string;
      copiedSha256?: string;
      originalSha256?: string;
      sourceAndCopyHashesUnchanged?: boolean;
    };
    tauri?: { validatorHealthChecks?: string };
  };
  const snapshot = report.source?.copyPath ?? "";
  const digest = report.source?.copiedSha256 ?? "";
  const name = path.basename(snapshot);
  if (
    !/^REPO_SAVE_\d{4}(?:_\d{2}){5}\.es3$/.test(name) ||
    snapshot !== path.join(intake, name) ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    digest !== report.source?.originalSha256 ||
    report.source?.sourceAndCopyHashesUnchanged !== true ||
    report.tauri?.validatorHealthChecks !== "pass"
  ) {
    throw new Error("The intake report does not identify a verified read-only Run copy.");
  }
  const metadata = await lstat(snapshot);
  if (
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    metadata.size > 32 * 1024 * 1024 ||
    (await realpath(snapshot)) !== path.normalize(snapshot)
  ) {
    throw new Error("The intake copy must be a bounded, single-link local file.");
  }
  const bytes = await readFile(snapshot);
  expect(hash(bytes)).toBe(digest);
  return { snapshot, name, bytes, digest };
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function preparedArtifact(variable: string) {
  const value = process.env[variable];
  if (!value) throw new Error(`${variable} must name a prepared synthetic safety artifact.`);
  const artifact = path.resolve(DESKTOP_ROOT, value);
  const relative = path.relative(build, artifact);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${variable} must be inside desktop/build.`);
  }
  return artifact;
}

function onlyHealthChanged(before: string, after: string, previous: number, next: number) {
  const comparison = `
import sys
from pathlib import Path
from repo_save_editor.core.schema import get_dictionaries
from repo_save_editor.storage.repository import SaveRepository
before, after = (SaveRepository.load(Path(p)) for p in sys.argv[1:3])
a, b = (get_dictionaries(data)["playerHealth"] for data in (before, after))
keys = [key for key in a if key in b and a[key] != b[key]]
expected = tuple(map(int, sys.argv[3:]))
changed = len(keys) == 1 and (a[keys[0]], b[keys[0]]) == expected
if changed:
    b[keys[0]] = a[keys[0]]
print("match" if changed and before == after else "mismatch")
`;
  const result = execFileSync(
    getPythonExecutable(),
    ["-B", "-c", comparison, before, after, String(previous), String(next)],
    { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT }, timeout: 15_000 },
  ).toString();
  expect(result.trim()).toBe("match");
}

test("Save Changes edits one Health field on a verified disposable copy", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const evidence = await verifiedSnapshot();
  const home = info.outputPath("isolated");
  const output = path.relative(recovery, home);
  if (
    !/^disposable-health-[a-f0-9-]+[\\/]/.test(output) ||
    (await realpath(recovery)) !== recovery
  ) {
    throw new Error("Use the dedicated disposable Health configuration.");
  }
  const host = preparedArtifact("REPODITOR_SAFETY_UI_HOST");
  const backend = preparedArtifact("REPODITOR_RECOVERY_BACKEND");
  const slot = path.parse(evidence.name).name;
  const save = path.join(
    home,
    "AppData",
    "LocalLow",
    "semiwork",
    "Repo",
    "saves",
    slot,
    evidence.name,
  );
  await mkdir(path.dirname(save), { recursive: true });
  if ((await realpath(path.dirname(save))) !== path.dirname(save)) {
    throw new Error("The working save directory must be free of path redirection.");
  }
  await writeFile(save, evidence.bytes, { flag: "wx" });
  const executable = path.join(home, "repoditor-preview.exe");
  await stageTestExecutable(host, executable);
  await stageFrozenBackend(home, backend);
  const app = await launch(executable, home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_PHASE: "",
    REPODITOR_RECOVERY_FINAL_GAME_STATUS: "",
    // Prevent public-avatar requests from resolving against the imported roster.
    HTTPS_PROXY: "http://127.0.0.1:1",
    HTTP_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1",
    NO_PROXY: "",
  });
  try {
    await app.page.context().route(/^https?:\/\//, (route) => route.abort());
    const openPlayers = async () => {
      await openRunWorkspace(app.page);
      await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "editing");
      await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    };
    await openPlayers();
    const input = app.page.getByRole("spinbutton", { name: "Current health", exact: true });
    const previous = Number(await input.inputValue());
    const next = previous === 0 ? 1 : previous - 1;
    const stage = async () => {
      await input.fill(String(next));
      await input.press("Tab");
    };
    await stage();
    await app.page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(app.page.getByTestId("workspace-review")).toBeVisible();
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    expect(hash(await readFile(save))).toBe(evidence.digest);
    await stage();
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    const afterHash = hash(await readFile(save));
    await expect(app.page.getByTestId("workspace")).toHaveAttribute(
      "data-session-fingerprint",
      afterHash,
    );
    onlyHealthChanged(evidence.snapshot, save, previous, next);
    await app.page.getByRole("button", { name: "Change save", exact: true }).click();
    await openPlayers();
    await expect(input).toHaveValue(String(next));
  } finally {
    await close(app.child, app.browser);
    expect(hash(await readFile(evidence.snapshot))).toBe(evidence.digest);
  }
  const files = await readdir(path.dirname(save));
  expect(files.includes(`.${evidence.name}.health-pending.json`)).toBe(false);
  const receipts = files.filter((name) => /^\..+\.health-[a-f0-9]{32}\.json$/.test(name));
  expect(receipts).toHaveLength(1);
  const receipt = JSON.parse(await readFile(path.join(path.dirname(save), receipts[0]), "utf8"));
  expect(receipt.before === evidence.digest && receipt.after === hash(await readFile(save))).toBe(
    true,
  );
  const backups = files.filter((name) => name.includes(".bak-health-"));
  expect(backups).toHaveLength(1);
  const backup = await readFile(path.join(path.dirname(save), backups[0]));
  expect(hash(backup)).toBe(evidence.digest);
  const restored = path.join(home, "restored-copy.es3");
  await writeFile(restored, backup, { flag: "wx" });
  expect(hash(await readFile(restored))).toBe(evidence.digest);
  await writeFile(
    info.outputPath("verification.json"),
    JSON.stringify(
      {
        result: "pass",
        snapshotSha256: evidence.digest,
        changedHealthFields: 1,
        unrelatedFieldsPreserved: true,
        canonicalRefreshAndReopenVerified: true,
        receiptSettled: true,
        exactBackupAndRestorationVerified: true,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
});
