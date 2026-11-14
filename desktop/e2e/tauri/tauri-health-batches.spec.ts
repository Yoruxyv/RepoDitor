import { mkdir, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  createRunSaveFixture,
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  getPythonExecutable,
  PYTHON_ROOT,
  stageTestExecutable,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import { close, launch, native, stageFrozenBackend } from "../support/tauriHarness";

type App = Awaited<ReturnType<typeof launch>>;
const edits = () => [
  { playerId: "111", before: 80, value: 17 },
  { playerId: "222", before: 0, value: 42 },
];
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must name a prepared safety artifact`);
  return path.resolve(DESKTOP_ROOT, value);
}
async function fixture(info: TestInfo, ordinary = false) {
  const home = info.outputPath("isolated");
  await mkdir(home, { recursive: true });
  const source = await createRunSaveFixture(home);
  await createGameFixture(home);
  const executable = path.join(home, "repoditor-preview.exe");
  await stageTestExecutable(
    required(ordinary ? "REPODITOR_RECOVERY_DEFAULT_EXECUTABLE" : "REPODITOR_SAFETY_UI_HOST"),
    executable,
  );
  await stageFrozenBackend(
    home,
    required(ordinary ? "REPODITOR_ARTIFACT_BACKEND" : "REPODITOR_RECOVERY_BACKEND"),
  );
  return { home, source, executable, before: await readFile(source) };
}
function data(source: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(
      getPythonExecutable(),
      [
        "-B",
        "-c",
        "import json,sys;from pathlib import Path;from repo_save_editor.core.crypto import decrypt_save;print(json.dumps(decrypt_save(Path(sys.argv[1]).read_bytes())))",
        source,
      ],
      {
        cwd: PYTHON_ROOT,
        env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      },
    ).toString(),
  );
}
function changed(original: Record<string, unknown>) {
  const expected = structuredClone(original);
  const dictionaries = expected["dictionaryOfDictionaries"] as {
    value: { playerHealth: Record<string, number> };
  };
  dictionaries.value.playerHealth["111"] = 17;
  dictionaries.value.playerHealth["222"] = 42;
  return expected;
}
async function exactBackup(source: string, before: Buffer) {
  const names = (await readdir(path.dirname(source))).filter((name) =>
    name.includes(".bak-health-"),
  );
  expect(names).toHaveLength(1);
  expect(await readFile(path.join(path.dirname(source), names[0]))).toEqual(before);
}
async function noEvidence(source: string) {
  expect(
    (await readdir(path.dirname(source))).filter(
      (name) => name.endsWith(".json") || name.includes(".bak-"),
    ),
  ).toEqual([]);
}
async function openPlayers(app: App, recovery = false) {
  await app.page.getByRole("button", { name: /Open workspace/ }).click();
  await expect(app.page.getByTestId("health-status")).toHaveAttribute(
    "data-phase",
    recovery ? "recovery" : "editing",
  );
  await app.page.getByRole("tab", { name: "Players", exact: true }).click();
}
async function stage(app: App, name: string, value: string) {
  await app.page.getByRole("button", { name: new RegExp(name) }).click();
  const input = app.page.getByRole("spinbutton", { name: "Current health", exact: true });
  await input.fill(value);
  await input.press("Tab");
}
async function stageBoth(app: App) {
  await stage(app, "Alpha", "17");
  await stage(app, "Beta", "42");
  await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
    "2 pending changes",
  );
}
async function phaseStarted(marker: string, phase: string) {
  let pid = 0;
  await expect
    .poll(async () => {
      try {
        const record = JSON.parse(await readFile(marker, "utf8")) as { pid: number; phase: string };
        pid = record.pid;
        return record.phase;
      } catch {
        return "";
      }
    })
    .toBe(phase);
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  return pid;
}
function killWriter(pid: number) {
  execFileSync(
    path.join(process.env["SYSTEMROOT"] ?? "C:\\Windows", "System32/taskkill.exe"),
    ["/PID", String(pid), "/T", "/F"],
    { windowsHide: true, stdio: "ignore", timeout: 10_000 },
  );
}

test("Health batch Save persists both players with one exact backup and no mixed-domain write", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const original = data(f.source);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openPlayers(app);
    await stageBoth(app);
    await app.page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(app.page.getByTestId("workspace-review")).toContainText("Alpha · Health");
    await expect(app.page.getByTestId("workspace-review")).toContainText("Beta · Health");
    for (const [width, height] of [
      [960, 640],
      [1200, 800],
      [1600, 900],
    ]) {
      await app.page.setViewportSize({ width, height });
      expect(
        await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await app.page.screenshot({ path: info.outputPath(`health-batch-${width}.png`) });
    }
    await app.page.getByRole("button", { name: "Revert", exact: true }).click();
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "1 pending change",
    );
    await stage(app, "Beta", "42");
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
    await stageBoth(app);
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await app.page.getByRole("spinbutton", { name: "Strength for Beta" }).fill("3");
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
    await app.page.getByRole("button", { name: "Revert upgrade drafts", exact: true }).click();
    await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    expect(data(f.source)).toEqual(changed(original));
    await exactBackup(f.source, f.before);
    const names = (await readdir(path.dirname(f.source))).filter((name) => name.endsWith(".json"));
    expect(names).toHaveLength(1);
    const receipt = JSON.parse(await readFile(path.join(path.dirname(f.source), names[0]), "utf8"));
    expect(receipt).toMatchObject({ version: 6, intent: { health: edits() } });
    expect(receipt.after).toBe(
      createHash("sha256")
        .update(await readFile(f.source))
        .digest("hex"),
    );
    await expect(app.page.getByTestId("workspace")).toHaveAttribute(
      "data-session-fingerprint",
      receipt.after,
    );
    await stage(app, "Beta", "50");
    await expect(app.page.getByTestId("health-status")).not.toContainText(
      "Original backup verified",
    );
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    await app.page.getByRole("button", { name: "Change save", exact: true }).click();
    await openPlayers(app);
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("17");
    await app.page.getByRole("button", { name: /Beta/ }).click();
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("42");
    expect(data(f.source)).toEqual(changed(original));
  } finally {
    await close(app.child, app.browser);
  }
});

for (const phase of ["before_replace", "after_replace"]) {
  test(`Health batch writer termination at ${phase} retains one recoverable intent`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const original = data(f.source);
    const marker = path.join(f.home, "writer-phase.json");
    const app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
      REPODITOR_RECOVERY_PHASE: phase,
      REPODITOR_RECOVERY_PHASE_FILE: marker,
    });
    let second: App | undefined;
    try {
      await openPlayers(app);
      if (phase === "before_replace") {
        const secondHome = path.join(f.home, "second-host");
        await mkdir(secondHome);
        const secondExe = path.join(secondHome, "repoditor-preview.exe");
        await stageTestExecutable(f.executable, secondExe);
        await stageFrozenBackend(secondHome, required("REPODITOR_RECOVERY_BACKEND"));
        second = await launch(secondExe, secondHome, {
          REPODITOR_E2E_LOCAL_APP_DATA_LOW: path.join(f.home, "AppData/LocalLow"),
          REPODITOR_E2E_STEAM_ROOT: path.join(f.home, "SteamLibrary"),
          REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
        });
        await openPlayers(second);
      }
      await stageBoth(app);
      await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      const pid = await phaseStarted(marker, phase);
      const operationId = await app.page
        .getByTestId("health-status")
        .getAttribute("data-operation-id");
      expect(operationId).toMatch(/^[0-9a-f]{32}$/);
      if (second)
        expect(
          await native(second.page, "test_health_write", {
            request: {
              saveId: E2E_SAVE_ID,
              fingerprint: createHash("sha256").update(f.before).digest("hex"),
              playerId: "111",
              health: 21,
              operationId: "d".repeat(32),
            },
          }),
        ).toMatchObject({ status: "rejected", reason: "write_busy" });
      killWriter(pid);
      await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
      await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toBeDisabled();
      const state = await native<{ pending: { operationId: string; intent: unknown } }>(
        app.page,
        "test_health_state",
        { saveId: E2E_SAVE_ID },
      );
      expect(state.pending).toMatchObject({ operationId, intent: { health: edits() } });
      await exactBackup(f.source, f.before);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      if (phase === "before_replace") {
        await expect(app.page.getByTestId("health-status")).toHaveAttribute(
          "data-phase",
          "unchanged",
        );
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "2 pending changes",
        );
        expect(await readFile(f.source)).toEqual(f.before);
        await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
        expect(await readFile(f.source)).toEqual(f.before);
      } else {
        await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "No pending changes",
        );
        expect(data(f.source)).toEqual(changed(original));
      }
    } finally {
      try {
        if (second) await close(second.child, second.browser);
      } finally {
        await close(app.child, app.browser);
      }
    }
  });
}

test("Health batch survives lost response and interrupted reconciliation across three hosts", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const original = data(f.source);
  const marker = path.join(f.home, "response-phase.json");
  const first = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_PHASE: "response_construction",
    REPODITOR_RECOVERY_PHASE_FILE: marker,
  });
  let operationId: string | null = null;
  try {
    await openPlayers(first);
    await stageBoth(first);
    await first.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await phaseStarted(marker, "response_construction");
    operationId = await first.page.getByTestId("health-status").getAttribute("data-operation-id");
  } finally {
    await close(first.child, first.browser);
  }
  expect(data(f.source)).toEqual(changed(original));
  const applied = await readFile(f.source);
  const recoveryMarker = path.join(f.home, "recovery-phase.json");
  const second = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_PHASE: "recovery_archive",
    REPODITOR_RECOVERY_PHASE_FILE: recoveryMarker,
  });
  try {
    await openPlayers(second, true);
    await expect(second.page.getByTestId("health-status")).toHaveAttribute(
      "data-operation-id",
      operationId!,
    );
    await expect(second.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "2 pending changes",
    );
    await second.page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(second.page.getByTestId("workspace-review")).toContainText("80 → 17");
    await expect(second.page.getByTestId("workspace-review")).toContainText("0 → 42");
    await second.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await phaseStarted(recoveryMarker, "recovery_archive");
  } finally {
    await close(second.child, second.browser);
  }
  const third = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openPlayers(third, true);
    const state = await native<{ pending: unknown }>(third.page, "test_health_state", {
      saveId: E2E_SAVE_ID,
    });
    expect(state.pending).toMatchObject({ operationId, intent: { health: edits() } });
    await third.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(third.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await expect(third.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    expect(await readFile(f.source)).toEqual(applied);
    await exactBackup(f.source, f.before);
  } finally {
    await close(third.child, third.browser);
  }
});

test("native Health batches reject malformed stale oversized and previous-session payloads intact", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openPlayers(app);
    const state = await native<{ upgradeSession: string }>(app.page, "test_health_state", {
      saveId: E2E_SAVE_ID,
    });
    const base = {
      saveId: E2E_SAVE_ID,
      fingerprint: createHash("sha256").update(f.before).digest("hex"),
      operationId: "a".repeat(32),
      session: state.upgradeSession,
      health: edits(),
    };
    for (const edit of [
      { value: true },
      { value: 1.5 },
      { value: -1 },
      { value: 101 },
      { value: 2_147_483_648 },
      { before: 1 },
      { before: 9_007_199_254_740_992 },
      { playerId: "999" },
      { field: "currency" },
    ]) {
      expect(
        await native(app.page, "test_health_write", {
          request: { ...base, health: [base.health[0], { ...base.health[1], ...edit }] },
        }),
      ).toMatchObject({ status: "rejected" });
      expect(await readFile(f.source)).toEqual(f.before);
      await noEvidence(f.source);
    }
    for (const health of [
      [],
      [...edits(), edits()[0]],
      Array.from({ length: 100 }, (_entry, n) => ({ playerId: String(n), before: 0, value: 1 })),
    ]) {
      expect(
        await native(app.page, "test_health_write", { request: { ...base, health } }),
      ).toMatchObject({ status: "rejected", reason: "invalid_request" });
    }
    expect(
      await native(app.page, "test_health_write", {
        request: { ...base, fingerprint: "f".repeat(64) },
      }),
    ).toMatchObject({ status: "rejected" });
    await native(app.page, "saves_open", { saveId: E2E_SAVE_ID });
    expect(await native(app.page, "test_health_write", { request: base })).toMatchObject({
      status: "rejected",
      reason: "invalid_request",
    });
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
  } finally {
    await close(app.child, app.browser);
  }
});

for (const status of ["running", "unknown", "query_error"]) {
  test(`final ${status} game check preserves the entire Health batch and recovery evidence`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
      REPODITOR_RECOVERY_FINAL_GAME_STATUS: status,
    });
    try {
      await openPlayers(app);
      await stageBoth(app);
      await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
      expect(await readFile(f.source)).toEqual(f.before);
      await exactBackup(f.source, f.before);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      await expect(app.page.getByTestId("health-status")).toHaveAttribute(
        "data-phase",
        "unchanged",
      );
      await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
        "2 pending changes",
      );
      const state = await native<{ pending: unknown }>(app.page, "test_health_state", {
        saveId: E2E_SAVE_ID,
      });
      expect(state.pending).toMatchObject({ intent: { health: edits() } });
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("ordinary packaged hosts deny Health batches and retain read-only Players", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, true);
  const app = await launch(f.executable, f.home);
  try {
    await app.page.getByRole("button", { name: /Open workspace/ }).click();
    await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveAttribute(
      "readonly",
      "",
    );
    await expect(app.page.getByRole("button", { name: "Save Changes", exact: true })).toHaveCount(
      0,
    );
    const request = {
      saveId: E2E_SAVE_ID,
      fingerprint: createHash("sha256").update(f.before).digest("hex"),
      operationId: "a".repeat(32),
      session: "forged",
      health: edits(),
    };
    expect(await native(app.page, "test_health_write", { request }).catch(String)).toMatch(
      /not found|not allowed|not permitted|denied/i,
    );
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
  } finally {
    await close(app.child, app.browser);
  }
});
