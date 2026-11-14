import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import type { CosmeticsViewDto, DesktopOperationResult } from "../../electron/contracts.cjs";
import {
  createMetaSaveFixture,
  DESKTOP_ROOT,
  getPythonExecutable,
  PYTHON_ROOT,
  stageTestExecutable,
} from "../support/fixtureEnvironment";
import { close, launch, native, stageFrozenBackend } from "../support/tauriHarness";

type App = Awaited<ReturnType<typeof launch>>;
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must name a safety artifact`);
  return path.resolve(DESKTOP_ROOT, value);
}
function python(code: string, args: string[]) {
  return execFileSync(getPythonExecutable(), ["-B", "-c", code, ...args], {
    cwd: PYTHON_ROOT,
    env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}
function data(source: string) {
  return JSON.parse(
    python(
      "import json,sys;from pathlib import Path;from repo_save_editor.core.crypto import decrypt_save;print(json.dumps(decrypt_save(Path(sys.argv[1]).read_bytes())))",
      [source],
    ).toString(),
  ) as Record<string, { value: unknown }>;
}
async function fixture(info: TestInfo, ordinary = false) {
  const home = info.outputPath("isolated");
  await mkdir(path.join(home, "AppData/LocalLow/semiwork/Repo"), { recursive: true });
  const source = createMetaSaveFixture(home);
  python(
    `import sys,runpy
from pathlib import Path
from repo_save_editor.core.crypto import decrypt_save,encrypt_save
p=Path(sys.argv[1]); d=decrypt_save(p.read_bytes());d['cosmeticPresets']['value']=[[27],[],[999]];d['colorPresets']['value']=[[1,2,3],[],[4]]
p.write_bytes(encrypt_save(d))
runpy.run_path(sys.argv[2])['create'](Path(sys.argv[3]))`,
    [
      source,
      path.join(DESKTOP_ROOT, "e2e/fixture_generators/create-meta-cosmetics-fixture.py"),
      home,
    ],
  );
  const executable = path.join(home, "repoditor-preview.exe");
  await stageTestExecutable(
    required(ordinary ? "REPODITOR_RECOVERY_DEFAULT_EXECUTABLE" : "REPODITOR_SAFETY_UI_HOST"),
    executable,
  );
  await stageFrozenBackend(
    home,
    required(ordinary ? "REPODITOR_ARTIFACT_BACKEND" : "REPODITOR_RECOVERY_BACKEND"),
  );
  const game = path.join(home, "SteamLibrary/steamapps/common/RepoDitor E2E Install");
  await stageTestExecutable(process.execPath, path.join(game, "REPO.exe"));
  return { home, source, executable, game, before: await readFile(source) };
}
async function open(app: App) {
  await app.page.getByRole("button", { name: "Cosmetics", exact: true }).click();
  await expect(app.page.getByTestId("meta-status")).toHaveAttribute("data-state", /idle|pending/);
}
async function save(app: App) {
  await app.page
    .getByTestId("cosmetics-action-bar")
    .getByRole("button", { name: "Save Changes", exact: true })
    .click();
  await expect(
    app.page.getByRole("dialog", { name: "Save synthetic Cosmetics changes?" }),
  ).toBeVisible();
  await app.page
    .getByRole("dialog")
    .getByRole("button", { name: "Save Changes", exact: true })
    .click();
}
async function backups(source: string) {
  return (await readdir(path.dirname(source))).filter((n) => n.includes(".bak-health-"));
}
async function exactBackup(source: string, before: Buffer) {
  const names = await backups(source);
  expect(names).toHaveLength(1);
  expect(await readFile(path.join(path.dirname(source), names[0]))).toEqual(before);
}
async function noPending(source: string) {
  await expect
    .poll(() =>
      readFile(path.join(path.dirname(source), ".MetaSave.es3.health-pending.json")).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
}
async function saved(app: App, source: string) {
  await expect(app.page.getByText("Changes saved and verified.", { exact: false })).toBeVisible();
  await noPending(source);
}
function kill(pid: number) {
  execFileSync(
    path.join(process.env["SYSTEMROOT"] ?? "C:\\Windows", "System32/taskkill.exe"),
    ["/PID", String(pid), "/T", "/F"],
    { windowsHide: true, stdio: "ignore", timeout: 10_000 },
  );
}

test("synthetic MetaSave selected unlocks confirm revert and save independently of Run sessions", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const original = data(f.source);
  const app = await launch(f.executable, f.home);
  try {
    await open(app);
    await expect(
      app.page.getByRole("button", { name: "Lock All Cosmetics", exact: true }),
    ).toBeDisabled();
    await app.page.getByRole("button", { name: "Unlock E2E Cosmetic 00", exact: true }).click();
    await app.page.getByRole("button", { name: "Unlock E2E Cosmetic 02", exact: true }).click();
    await expect(app.page.getByTestId("cosmetics-pending-edit-count")).toHaveText(
      "2 pending changes",
    );
    expect(await readFile(f.source)).toEqual(f.before);
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backups(f.source)).toEqual([]);
    await app.page.getByRole("button", { name: "Unlock E2E Cosmetic 00", exact: true }).click();
    await app.page
      .getByTestId("cosmetics-action-bar")
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    await app.page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .press("Escape");
    expect(await readFile(f.source)).toEqual(f.before);
    await app.page.getByRole("button", { name: "Unlock E2E Cosmetic 02", exact: true }).click();
    await save(app);
    await saved(app, f.source);
    const expected = structuredClone(original);
    expected["cosmeticUnlocks"].value = [27, 999, 0, 2];
    expected["cosmeticHistory"].value = [27, 999, 0, 2];
    expect(data(f.source)).toEqual(expected);
    await exactBackup(f.source, f.before);
    for (const [width, height] of [
      [960, 640],
      [1200, 800],
      [1600, 900],
    ]) {
      await app.page.setViewportSize({ width: width, height: height });
      expect(
        await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await app.page.screenshot({ path: info.outputPath(`meta-${width}.png`) });
    }
  } finally {
    await close(app.child, app.browser);
  }
});

test("synthetic MetaSave bulk actions clear paired presets and preserve unknown ownership", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home);
  try {
    await open(app);
    const equipped = data(f.source)["cosmeticEquipped"];
    await app.page.getByRole("button", { name: "Clear All Presets", exact: true }).click();
    await save(app);
    await saved(app, f.source);
    expect(data(f.source)["cosmeticPresets"].value).toEqual([[], [], []]);
    expect(data(f.source)["colorPresets"].value).toEqual([[], [], []]);
    await expect(
      app.page.getByRole("button", { name: "Lock All Cosmetics", exact: true }),
    ).toBeEnabled();
    await app.page.getByRole("button", { name: "Lock All Cosmetics", exact: true }).click();
    await save(app);
    await saved(app, f.source);
    expect(data(f.source)["cosmeticUnlocks"].value).toEqual([999]);
    await expect(
      app.page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }),
    ).toBeEnabled();
    await app.page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
    await save(app);
    await saved(app, f.source);
    expect(data(f.source)["cosmeticUnlocks"].value).toEqual([
      999,
      ...Array.from({ length: 28 }, (_, i) => i),
    ]);
    expect(data(f.source)["cosmeticEquipped"]).toEqual(equipped);
    expect(await backups(f.source)).toHaveLength(3);
  } finally {
    await close(app.child, app.browser);
  }
});

for (const phase of ["before_replace", "after_replace"])
  test(`MetaSave writer termination at ${phase} preserves independent recovery and exact backup`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const marker = info.outputPath("phase.json");
    let app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_PHASE: phase,
      REPODITOR_RECOVERY_PHASE_FILE: marker,
    });
    try {
      await open(app);
      await app.page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
      await save(app);
      let pid = 0;
      await expect
        .poll(async () => {
          try {
            const value = JSON.parse(await readFile(marker, "utf8")) as {
              pid: number;
              phase: string;
            };
            pid = value.pid;
            return value.phase;
          } catch {
            return "";
          }
        })
        .toBe(phase);
      expect(pid).toBeGreaterThan(0);
      kill(pid);
      await close(app.child, app.browser);
      await rename(
        path.join(f.game, "REPO_Data/level0"),
        path.join(f.game, "REPO_Data/level0.hidden"),
      );
      const interrupted = await readFile(f.source);
      app = await launch(f.executable, f.home);
      await open(app);
      await expect(
        app.page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }),
      ).toHaveCount(0);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      await noPending(f.source);
      expect(await readFile(f.source)).toEqual(interrupted);
      if (phase === "before_replace") expect(interrupted).toEqual(f.before);
      await exactBackup(f.source, f.before);
    } finally {
      await close(app.child, app.browser);
    }
  });

test("MetaSave response loss survives host restart without replay or fresh recovery write authority", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  let app = await launch(f.executable, f.home, { REPODITOR_RECOVERY_PHASE: "response_error" });
  try {
    await open(app);
    await app.page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
    await save(app);
    await expect(
      app.page.getByRole("button", { name: "Reconcile changes", exact: true }),
    ).toBeEnabled();
    const written = await readFile(f.source);
    expect(written).not.toEqual(f.before);
    await exactBackup(f.source, f.before);
    await close(app.child, app.browser);
    app = await launch(f.executable, f.home);
    await open(app);
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await noPending(f.source);
    expect(await readFile(f.source)).toEqual(written);
    await exactBackup(f.source, f.before);
  } finally {
    await close(app.child, app.browser);
  }
});

type State = {
  session: string;
  namespace: string;
  view: { fingerprint: string };
  admission: { digest: string };
};

function forgedRequest(state: State, damage: string, oldSession: string) {
  const action = { action: "unlockIds", admission: state.admission.digest, ids: [0, 2] };
  const request: Record<string, unknown> = {
    operationId: crypto.randomUUID().replaceAll("-", ""),
    fingerprint: state.view.fingerprint,
    session: state.session,
    intent: { metaCosmetics: action },
  };
  if (damage === "old-session") request["session"] = oldSession;
  if (damage === "unknown") action.ids = [999];
  if (damage === "duplicate") action.ids = [0, 0];
  if (damage === "fraction") action.ids = [1.5];
  if (damage === "oversized") action.ids = Array.from({ length: 513 }, (_, i) => i);
  if (damage === "mixed") request["intent"] = { metaCosmetics: action, health: [] };
  if (damage === "fingerprint") request["fingerprint"] = "f".repeat(64);
  if (damage === "admission") action.admission = "f".repeat(64);
  return request;
}

test("native MetaSave rejects cross-domain old-session forged bounded and stale requests", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home);
  try {
    await open(app);
    const first = await native<State>(app.page, "test_meta_state", { request: {} });
    for (const damage of [
      "old-session",
      "unknown",
      "duplicate",
      "fraction",
      "oversized",
      "mixed",
      "fingerprint",
      "admission",
    ]) {
      const state = await native<State>(app.page, "test_meta_state", { request: {} });
      const request = forgedRequest(state, damage, first.session);
      expect(await native(app.page, "test_meta_write", { request })).toMatchObject({
        status: "rejected",
      });
    }
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backups(f.source)).toEqual([]);
    const state = await native<State>(app.page, "test_meta_state", { request: {} });
    python(
      "import sys;from pathlib import Path;from repo_save_editor.core.crypto import decrypt_save,encrypt_save;p=Path(sys.argv[1]);d=decrypt_save(p.read_bytes());d['cosmeticTokens']['value']=[8];p.write_bytes(encrypt_save(d))",
      [f.source],
    );
    const stale = await readFile(f.source);
    expect(
      await native(app.page, "test_meta_write", {
        request: {
          operationId: crypto.randomUUID().replaceAll("-", ""),
          fingerprint: state.view.fingerprint,
          session: state.session,
          intent: { metaCosmetics: { action: "unlockAll", admission: state.admission.digest } },
        },
      }),
    ).toMatchObject({ status: "rejected" });
    expect(await readFile(f.source)).toEqual(stale);
    expect(await backups(f.source)).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

for (const fault of ["backup_error", "staging_error"])
  test(`MetaSave ${fault} retains original bytes and pending recovery`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const app = await launch(f.executable, f.home, { REPODITOR_RECOVERY_PHASE: fault });
    try {
      await open(app);
      await app.page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
      await save(app);
      await expect(
        app.page.getByRole("button", { name: "Reconcile changes", exact: true }),
      ).toBeEnabled();
      expect(await readFile(f.source)).toEqual(f.before);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      await noPending(f.source);
      expect(await readFile(f.source)).toEqual(f.before);
      if (fault === "staging_error") await exactBackup(f.source, f.before);
    } finally {
      await close(app.child, app.browser);
    }
  });

test("final unknown game status blocks MetaSave replacement after pinned admission revalidation", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_FINAL_GAME_STATUS: "unknown",
  });
  try {
    await open(app);
    await app.page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
    await save(app);
    await expect(
      app.page.getByRole("button", { name: "Reconcile changes", exact: true }),
    ).toBeEnabled();
    expect(await readFile(f.source)).toEqual(f.before);
    await exactBackup(f.source, f.before);
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary packaged hosts deny every MetaSave mutation and recovery capability", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, true);
  const manifest = path.resolve(f.game, "../../appmanifest_3241660.acf");
  await writeFile(manifest, (await readFile(manifest, "utf8")).replace("26294889", "26407089"));
  const app = await launch(f.executable, f.home);
  try {
    await app.page.getByRole("button", { name: "Cosmetics", exact: true }).click();
    await expect(app.page.getByText("E2E Cosmetic 00", { exact: true })).toBeVisible();
    const view = await native<DesktopOperationResult<CosmeticsViewDto>>(
      app.page,
      "cosmetics_get",
      {},
    );
    expect(view).toMatchObject({
      ok: true,
      data: {
        knownCatalogCount: 28,
        capabilities: { canUnlockAll: false, canRemoveOwnership: false, canClearPresets: false },
      },
    });
    if (!view.ok) throw new Error("Read-only current-build catalog was not available");
    expect(view.data.savedPresetCount).toBeGreaterThan(0);
    expect(view.data.cosmetics.every((c) => !c.mutationEligible && c.iconToken === null)).toBe(
      true,
    );
    await expect(
      app.page.getByRole("button", {
        name: /Unlock All|Lock All|Clear All Presets|Save Changes|Revert all/,
      }),
    ).toHaveCount(0);
    for (const command of ["test_meta_state", "test_meta_write", "test_meta_recover"])
      await expect(native(app.page, command, { request: {} })).rejects.toBeDefined();
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backups(f.source)).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});
