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
const KEY = "Item Melee Inflatable Hammer/1";
const OTHER = "Item Melee Inflatable Hammer/2";
const FULL = "Item Melee Inflatable Hammer/3";
const UNKNOWN = "Item Mystery/7";
const CART = "Item Cart Medium/1";
const edits = () => [{ saveKey: KEY, before: 99 }];
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must name a prepared safety artifact`);
  return path.resolve(DESKTOP_ROOT, value);
}
function python(script: string, source: string) {
  return execFileSync(getPythonExecutable(), ["-B", "-c", script, source], {
    cwd: PYTHON_ROOT,
    env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
}
function data(source: string): Record<string, unknown> {
  return JSON.parse(
    python(
      "import json,sys;from pathlib import Path;from repo_save_editor.core.crypto import decrypt_save;print(json.dumps(decrypt_save(Path(sys.argv[1]).read_bytes())))",
      source,
    ).toString(),
  );
}
async function fixture(info: TestInfo, ordinary = false) {
  const home = info.outputPath("isolated");
  await mkdir(home, { recursive: true });
  const source = await createRunSaveFixture(home);
  python(
    `import sys
from pathlib import Path
from repo_save_editor.core.crypto import decrypt_save,encrypt_save
p=Path(sys.argv[1]); d=decrypt_save(p.read_bytes()); v=d['dictionaryOfDictionaries']['value']
v['item'].update({'${OTHER}':21,'${FULL}':21,'${UNKNOWN}':1})
v['itemStatBattery'].update({'${OTHER}':42,'${UNKNOWN}':8,'${CART}':33,'unlinked':12})
v['itemBatteryUpgrades']['${KEY}']=7
p.write_bytes(encrypt_save(d))`,
    source,
  );
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
async function openItems(app: App, recovery = false) {
  await app.page.getByRole("button", { name: /Open workspace/ }).click();
  await expect(app.page.getByTestId("health-status")).toHaveAttribute(
    "data-phase",
    recovery ? "recovery" : "editing",
  );
  await app.page.getByRole("tab", { name: "Items", exact: true }).click();
  await expect(app.page.getByTestId("item-group-Melee Inflatable Hammer")).toBeVisible();
}
async function stage(app: App) {
  await app.page
    .getByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1", exact: true })
    .click();
  await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText("1 pending change");
}
async function backup(source: string, before: Buffer) {
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
function expected(original: Record<string, unknown>) {
  const changed = structuredClone(original);
  const dictionaries = changed["dictionaryOfDictionaries"] as {
    value: { itemStatBattery: Record<string, number> };
  };
  delete dictionaries.value.itemStatBattery[KEY];
  return changed;
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

test("synthetic refill Save removes only the selected charge leaf and preserves same-name instances", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const original = data(f.source);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openItems(app);
    const read = await native<{
      ok: boolean;
      data: { items: { saveKey: string; rechargeCapability: string; canRefillToFull: boolean }[] };
    }>(app.page, "advanced_get", { saveId: E2E_SAVE_ID });
    expect(read.ok).toBe(true);
    expect(read.data.items.find((i) => i.saveKey === KEY)).toMatchObject({
      rechargeCapability: "rechargeable",
      canRefillToFull: true,
    });
    expect(read.data.items.find((i) => i.saveKey === UNKNOWN)).toMatchObject({
      rechargeCapability: "unknown",
      canRefillToFull: false,
    });
    expect(read.data.items.find((i) => i.saveKey === CART)).toMatchObject({
      rechargeCapability: "not_rechargeable",
      canRefillToFull: false,
    });
    expect(read.data.items.find((i) => i.saveKey === FULL)).toMatchObject({
      canRefillToFull: false,
    });
    await app.page.getByRole("button", { name: "Recharge All Tools", exact: true }).click();
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "2 pending changes",
    );
    await app.page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(app.page.getByTestId("workspace-review")).toContainText(
      "Melee Inflatable Hammer · Charge",
    );
    for (const [width, height] of [
      [960, 640],
      [1200, 800],
      [1600, 900],
    ]) {
      await app.page.setViewportSize({ width, height });
      expect(
        await app.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await app.page.screenshot({ path: info.outputPath(`refill-${width}.png`) });
    }
    await app.page
      .getByTestId(`item-instance-${OTHER}`)
      .getByRole("button", { name: "Revert recharge", exact: true })
      .click();
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "1 pending change",
    );
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
    await stage(app);
    await app.page.getByRole("tab", { name: "Run", exact: true }).click();
    await app.page.getByRole("spinbutton", { name: "Currency", exact: true }).fill("4");
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
    await app.page.getByRole("button", { name: "Revert", exact: true }).click();
    await app.page.getByRole("tab", { name: "Items", exact: true }).click();
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).focus();
    await app.page.keyboard.press("Enter");
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    await expect(app.page.getByTestId(`item-instance-${KEY}`)).toContainText("Full");
    await expect(app.page.getByTestId(`item-instance-${OTHER}`)).toContainText(
      "Current charge: 42",
    );
    expect(data(f.source)).toEqual(expected(original));
    await backup(f.source, f.before);
    const names = (await readdir(path.dirname(f.source))).filter((n) => n.endsWith(".json"));
    expect(names).toHaveLength(1);
    const receipt = JSON.parse(await readFile(path.join(path.dirname(f.source), names[0]), "utf8"));
    expect(receipt).toMatchObject({
      version: 7,
      intent: { refillToFull: edits() },
      after: digest(await readFile(f.source)),
    });
    await expect(app.page.getByTestId("workspace")).toHaveAttribute(
      "data-session-fingerprint",
      receipt.after,
    );
    await app.page.getByRole("button", { name: "Change save", exact: true }).click();
    await openItems(app);
    await expect(app.page.getByTestId(`item-instance-${KEY}`)).toContainText("Full");
    expect(data(f.source)).toEqual(expected(original));
  } finally {
    await close(app.child, app.browser);
  }
});

for (const phase of ["before_replace", "after_replace"]) {
  test(`refill writer termination at ${phase} restores one durable exact-instance intent`, async ({
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
    try {
      await openItems(app);
      await stage(app);
      await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      killWriter(await phaseStarted(marker, phase));
      await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
      const state = await native<{ pending: unknown }>(app.page, "test_health_state", {
        saveId: E2E_SAVE_ID,
      });
      expect(state.pending).toMatchObject({ intent: { refillToFull: edits() } });
      await expect(
        app.page.getByRole("button", { name: "Recharge All Tools", exact: true }),
      ).toBeDisabled();
      await backup(f.source, f.before);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      if (phase === "before_replace") {
        await expect(app.page.getByTestId("health-status")).toHaveAttribute(
          "data-phase",
          "unchanged",
        );
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "1 pending change",
        );
        expect(await readFile(f.source)).toEqual(f.before);
        await app.page
          .getByTestId(`item-instance-${KEY}`)
          .getByRole("button", { name: "Revert recharge", exact: true })
          .click();
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "No pending changes",
        );
        expect(await readFile(f.source)).toEqual(f.before);
      } else {
        await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "No pending changes",
        );
        expect(data(f.source)).toEqual(expected(original));
      }
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("refill survives response loss and interrupted reconciliation across three hosts", async ({
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
    await openItems(first);
    await stage(first);
    await first.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await phaseStarted(marker, "response_construction");
    operationId = await first.page.getByTestId("health-status").getAttribute("data-operation-id");
  } finally {
    await close(first.child, first.browser);
  }
  expect(data(f.source)).toEqual(expected(original));
  const applied = await readFile(f.source);
  const recoveryMarker = path.join(f.home, "recovery-phase.json");
  const second = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_PHASE: "recovery_archive",
    REPODITOR_RECOVERY_PHASE_FILE: recoveryMarker,
  });
  try {
    await openItems(second, true);
    await expect(second.page.getByTestId("health-status")).toHaveAttribute(
      "data-operation-id",
      operationId!,
    );
    await expect(second.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "1 pending change",
    );
    await second.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await phaseStarted(recoveryMarker, "recovery_archive");
  } finally {
    await close(second.child, second.browser);
  }
  const third = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openItems(third, true);
    const state = await native<{ pending: unknown }>(third.page, "test_health_state", {
      saveId: E2E_SAVE_ID,
    });
    expect(state.pending).toMatchObject({ operationId, intent: { refillToFull: edits() } });
    await third.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(third.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await expect(third.page.getByTestId(`item-instance-${KEY}`)).toContainText("Full");
    await expect(third.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    expect(await readFile(f.source)).toEqual(applied);
    await backup(f.source, f.before);
  } finally {
    await close(third.child, third.browser);
  }
});

test("native refills reject ineligible unknown duplicate stale oversized and forged requests", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openItems(app);
    const state = await native<{ upgradeSession: string }>(app.page, "test_health_state", {
      saveId: E2E_SAVE_ID,
    });
    const base = {
      saveId: E2E_SAVE_ID,
      fingerprint: digest(f.before),
      operationId: "a".repeat(32),
      session: state.upgradeSession,
      refillToFull: edits(),
    };
    for (const edit of [
      { saveKey: UNKNOWN, before: 8 },
      { saveKey: CART, before: 33 },
      { saveKey: FULL, before: 0 },
      { saveKey: "Item Missing/1", before: 0 },
      { before: 1 },
      { before: true },
      { before: 1.5 },
      { value: 100 },
    ]) {
      expect(
        await native(app.page, "test_items_refill", {
          request: { ...base, refillToFull: [{ ...edits()[0], ...edit }] },
        }),
      ).toMatchObject({ status: "rejected" });
      expect(await readFile(f.source)).toEqual(f.before);
      await noEvidence(f.source);
    }
    for (const refillToFull of [
      [],
      [...edits(), ...edits()],
      Array.from({ length: 100 }, (_e, n) => ({ saveKey: `Item Tool/${n}`, before: 1 })),
    ]) {
      expect(
        await native(app.page, "test_items_refill", { request: { ...base, refillToFull } }),
      ).toMatchObject({ status: "rejected", reason: "invalid_request" });
    }
    expect(
      await native(app.page, "test_items_refill", {
        request: { ...base, health: [{ playerId: "111", before: 80, value: 17 }] },
      }),
    ).toMatchObject({ status: "rejected", reason: "invalid_request" });
    expect(
      await native(app.page, "test_items_refill", {
        request: { ...base, fingerprint: "f".repeat(64) },
      }),
    ).toMatchObject({ status: "rejected" });
    await native(app.page, "saves_open", { saveId: E2E_SAVE_ID });
    expect(await native(app.page, "test_items_refill", { request: base })).toMatchObject({
      status: "rejected",
      reason: "invalid_request",
    });
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
  } finally {
    await close(app.child, app.browser);
  }
});

for (const phase of ["backup_error", "staging_error"]) {
  test(`refill ${phase} keeps original bytes and recoverable intent`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
      REPODITOR_RECOVERY_PHASE: phase,
    });
    try {
      await openItems(app);
      await stage(app);
      await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
      expect(await readFile(f.source)).toEqual(f.before);
      if (phase === "staging_error") await backup(f.source, f.before);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      await expect(app.page.getByTestId("health-status")).toHaveAttribute(
        "data-phase",
        "unchanged",
      );
      await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
        "1 pending change",
      );
      const state = await native<{ pending: unknown }>(app.page, "test_health_state", {
        saveId: E2E_SAVE_ID,
      });
      expect(state.pending).toMatchObject({ intent: { refillToFull: edits() } });
      expect(await readFile(f.source)).toEqual(f.before);
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("final unknown game state blocks refill replacement with an exact backup", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_FINAL_GAME_STATUS: "unknown",
  });
  try {
    await openItems(app);
    await stage(app);
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
    expect(await readFile(f.source)).toEqual(f.before);
    await backup(f.source, f.before);
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "unchanged");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "1 pending change",
    );
    expect(await readFile(f.source)).toEqual(f.before);
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary packaged hosts deny item refill authority", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, true);
  const app = await launch(f.executable, f.home);
  try {
    await app.page.getByRole("button", { name: /Open workspace/ }).click();
    await app.page.getByRole("tab", { name: "Items", exact: true }).click();
    await expect(app.page.getByTestId("item-group-Melee Inflatable Hammer")).toBeVisible();
    await expect(
      app.page.getByRole("button", { name: /Recharge|Revert|Save Changes/ }),
    ).toHaveCount(0);
    expect(
      await native(app.page, "test_items_refill", {
        request: {
          saveId: E2E_SAVE_ID,
          fingerprint: digest(f.before),
          operationId: "a".repeat(32),
          session: "forged",
          refillToFull: edits(),
        },
      }).catch(String),
    ).toMatch(/not found|not allowed|not permitted|denied/i);
    expect(await readFile(f.source)).toEqual(f.before);
    await noEvidence(f.source);
  } finally {
    await close(app.child, app.browser);
  }
});
