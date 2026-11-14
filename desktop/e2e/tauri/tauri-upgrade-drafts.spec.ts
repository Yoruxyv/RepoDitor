import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  createRunSaveFixture,
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  stageTestExecutable,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import { close, launch, native, stageFrozenBackend } from "../support/tauriHarness";

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
  await stageFrozenBackend(home, required("REPODITOR_RECOVERY_BACKEND"));
  return { home, source, executable, before: await readFile(source) };
}
async function openUpgrades(app: Awaited<ReturnType<typeof launch>>) {
  await app.page.getByRole("button", { name: /Open workspace/ }).click();
  await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "editing");
  await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
  await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toBeVisible();
}

test("synthetic upgrade drafts review and revert without writing save or receipt bytes", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openUpgrades(app);
    const alpha = app.page.getByRole("spinbutton", { name: "Strength for Alpha" });
    await alpha.fill("3");
    await alpha.press("Tab");
    await app.page.getByRole("combobox", { name: "Player", exact: true }).click();
    await app.page.getByRole("option", { name: "Beta", exact: true }).click();
    const beta = app.page.getByRole("spinbutton", { name: "Strength for Beta" });
    await beta.fill("2147483647");
    await beta.press("Tab");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "2 pending changes",
    );
    await app.page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(app.page.getByTestId("workspace-review")).toContainText("Alpha · Strength");
    await expect(app.page.getByTestId("workspace-review")).toContainText("0 → 2147483647");
    await expect(app.page.getByRole("button", { name: "Save Changes", exact: true })).toBeEnabled();
    const tab = app.page.getByRole("tab", { name: "Upgrades", exact: true });
    await tab.focus();
    await tab.press("ArrowLeft");
    await app.page.getByRole("tab", { name: "Players", exact: true }).press("ArrowRight");
    await expect(tab).toBeFocused();
    await expect(beta).toHaveValue("2147483647");
    await beta.fill("2147483648");
    await expect(beta).toHaveAttribute("aria-invalid", "true");
    await expect(app.page.getByRole("alert")).toContainText("2,147,483,647");
    await app.page.getByRole("button", { name: "Revert upgrade drafts", exact: true }).click();
    await expect(beta).toHaveValue("0");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    await beta.fill("4");
    for (const width of [960, 1200, 1600]) {
      await app.page.setViewportSize({ width, height: 900 });
      expect(
        await app.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await app.page.screenshot({ path: info.outputPath(`upgrade-draft-${width}.png`) });
    }
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    await expect(beta).toHaveValue("0");
    await beta.fill("5");
    await app.page.getByRole("button", { name: "Change save", exact: true }).click();
    await openUpgrades(app);
    await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toHaveValue("2");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    expect(await readFile(f.source)).toEqual(f.before);
    expect(
      (await readdir(path.dirname(f.source))).filter(
        (name) => (name.includes("health") && !name.endsWith(".lock")) || name.includes(".bak"),
      ),
    ).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

async function exactUpgradeBackup(source: string, before: Buffer) {
  const names = (await readdir(path.dirname(source))).filter((name) =>
    name.includes(".bak-health-"),
  );
  expect(names).toHaveLength(1);
  expect(await readFile(path.join(path.dirname(source), names[0]))).toEqual(before);
}
async function phaseStarted(marker: string, phase: string) {
  let pid = 0;
  await expect
    .poll(async () => {
      try {
        const value = JSON.parse(await readFile(marker, "utf8")) as { phase: string; pid: number };
        pid = value.pid;
        return value.phase;
      } catch {
        return "";
      }
    })
    .toBe(phase);
  return pid;
}

test("synthetic upgrade batch Save reopens persisted values and Revert keeps them", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openUpgrades(app);
    await app.page.getByRole("spinbutton", { name: "Strength for Alpha" }).fill("3");
    await app.page.getByRole("combobox", { name: "Player", exact: true }).click();
    await app.page.getByRole("option", { name: "Beta", exact: true }).click();
    await app.page.getByRole("spinbutton", { name: "Strength for Beta" }).fill("4");
    await app.page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(app.page.getByTestId("workspace-review")).toContainText("Alpha · Strength");
    await expect(app.page.getByTestId("workspace-review")).toContainText("Beta · Strength");
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await expect(app.page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("4");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    await exactUpgradeBackup(f.source, f.before);
    const persisted = await readFile(f.source);
    expect(persisted).not.toEqual(f.before);
    await app.page.getByRole("button", { name: "Change save", exact: true }).click();
    await openUpgrades(app);
    const alpha = app.page.getByRole("spinbutton", { name: "Strength for Alpha" });
    await expect(alpha).toHaveValue("3");
    await alpha.fill("8");
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    await expect(alpha).toHaveValue("3");
    expect(await readFile(f.source)).toEqual(persisted);
    expect(
      (await readdir(path.dirname(f.source))).filter((name) =>
        name.endsWith("health-pending.json"),
      ),
    ).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

for (const phase of ["before_replace", "after_replace"]) {
  test(`upgrade writer termination at ${phase} reconciles without partial edits`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const marker = path.join(f.home, "phase.json");
    const app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
      REPODITOR_RECOVERY_PHASE: phase,
      REPODITOR_RECOVERY_PHASE_FILE: marker,
    });
    try {
      await openUpgrades(app);
      await app.page.getByRole("spinbutton", { name: "Strength for Alpha" }).fill("3");
      await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      const pid = await phaseStarted(marker, phase);
      execFileSync(
        path.join(process.env["SYSTEMROOT"] ?? "C:\\Windows", "System32/taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
      await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toBeDisabled();
      const fingerprint = await app.page
        .getByTestId("workspace")
        .getAttribute("data-session-fingerprint");
      expect(
        await native(app.page, "test_health_write", {
          request: {
            saveId: E2E_SAVE_ID,
            fingerprint,
            playerId: "111",
            health: 17,
            operationId: "c".repeat(32),
          },
        }),
      ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
      await exactUpgradeBackup(f.source, f.before);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      if (phase === "before_replace") {
        await expect(app.page.getByTestId("health-status")).toHaveAttribute(
          "data-phase",
          "unchanged",
        );
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "1 pending change",
        );
        await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
        await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toHaveValue(
          "2",
        );
        expect(await readFile(f.source)).toEqual(f.before);
      } else {
        await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
        await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toHaveValue(
          "3",
        );
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "No pending changes",
        );
      }
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("upgrade intent survives lost response and interrupted recovery across host handoff", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const marker = path.join(f.home, "writer-phase.json");
  const first = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_PHASE: "after_replace",
    REPODITOR_RECOVERY_PHASE_FILE: marker,
  });
  try {
    await openUpgrades(first);
    await first.page.getByRole("spinbutton", { name: "Strength for Alpha" }).fill("3");
    await first.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await phaseStarted(marker, "after_replace");
  } finally {
    await close(first.child, first.browser);
  }
  const applied = await readFile(f.source);
  expect(applied).not.toEqual(f.before);
  const recoveryMarker = path.join(f.home, "recovery-phase.json");
  const second = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_PHASE: "recovery_archive",
    REPODITOR_RECOVERY_PHASE_FILE: recoveryMarker,
  });
  try {
    await second.page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(second.page.getByTestId("health-status")).toHaveAttribute(
      "data-phase",
      "recovery",
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
    await third.page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(third.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
    await third.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(third.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await third.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await expect(third.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toHaveValue(
      "3",
    );
    expect(await readFile(f.source)).toEqual(applied);
    await exactUpgradeBackup(f.source, f.before);
  } finally {
    await close(third.child, third.browser);
  }
});

test("native upgrades reject forged values and previous open-session requests", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openUpgrades(app);
    const state = await native<{ upgradeSession: string }>(app.page, "test_health_state", {
      saveId: E2E_SAVE_ID,
    });
    const fingerprint = await app.page
      .getByTestId("workspace")
      .getAttribute("data-session-fingerprint");
    const base = {
      saveId: E2E_SAVE_ID,
      fingerprint,
      operationId: "a".repeat(32),
      session: state.upgradeSession,
      upgrades: [{ playerId: "111", key: "playerUpgradeStrength", before: 2, value: 3 }],
    };
    for (const edit of [
      { value: -1 },
      { value: true },
      { playerId: "999" },
      { key: "playerUpgradeForged" },
      { before: 1 },
    ]) {
      expect(
        await native(app.page, "test_upgrades_write", {
          request: { ...base, upgrades: [{ ...base.upgrades[0], ...edit }] },
        }),
      ).toMatchObject({ status: "rejected" });
    }
    await native(app.page, "saves_open", { saveId: E2E_SAVE_ID });
    expect(await native(app.page, "test_upgrades_write", { request: base })).toMatchObject({
      status: "rejected",
      reason: "invalid_request",
    });
    expect(await readFile(f.source)).toEqual(f.before);
    expect(
      (await readdir(path.dirname(f.source))).filter(
        (name) => name.endsWith(".json") || name.includes(".bak"),
      ),
    ).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

test("final unknown game state blocks the entire upgrade batch with recovery evidence", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_FINAL_GAME_STATUS: "unknown",
  });
  try {
    await openUpgrades(app);
    await app.page.getByRole("spinbutton", { name: "Strength for Alpha" }).fill("3");
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
    expect(await readFile(f.source)).toEqual(f.before);
    await exactUpgradeBackup(f.source, f.before);
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "unchanged");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "1 pending change",
    );
  } finally {
    await close(app.child, app.browser);
  }
});

test("upgrade drafts block partial health Save until explicitly reverted", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openUpgrades(app);
    await app.page.getByRole("spinbutton", { name: "Strength for Alpha" }).fill("3");
    await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    const health = app.page.getByRole("spinbutton", { name: "Current health", exact: true });
    await health.fill("17");
    await health.press("Tab");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "2 pending changes",
    );
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    expect(await readFile(f.source)).toEqual(f.before);
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await app.page.getByRole("button", { name: "Revert upgrade drafts", exact: true }).click();
    await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    const backups = (await readdir(path.dirname(f.source))).filter((name) =>
      name.includes(".bak-health-"),
    );
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(f.source), backups[0]))).toEqual(f.before);
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toHaveValue("2");
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary artifact retains read-only upgrades with no draft controls", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, true);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await app.page.getByRole("button", { name: /Open workspace/ }).click();
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    const value = app.page.getByRole("textbox", { name: "Strength for Alpha" });
    await expect(value).toHaveAttribute("readonly");
    await value.focus();
    await value.press("ArrowUp");
    await expect(value).toHaveValue("2");
    await expect(app.page.getByRole("spinbutton")).toHaveCount(0);
    await expect(
      app.page.getByRole("button", { name: "Revert upgrade drafts", exact: true }),
    ).toHaveCount(0);
    expect(await readFile(f.source)).toEqual(f.before);
  } finally {
    await close(app.child, app.browser);
  }
});
