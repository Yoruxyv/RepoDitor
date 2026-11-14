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
  const home = info.outputPath(ordinary ? "ordinary" : "isolated");
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
async function openRun(app: Awaited<ReturnType<typeof launch>>) {
  await app.page.getByRole("button", { name: /Open workspace/ }).click();
  await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "editing");
  await app.page.getByRole("tab", { name: "Run", exact: true }).click();
  await expect(app.page.getByRole("spinbutton", { name: "Level", exact: true })).toHaveValue("5");
}
async function exactBackup(source: string, before: Buffer) {
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

test("synthetic Run Save persists all supported fields and Revert never writes", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openRun(app);
    const page = app.page;
    await page.getByRole("spinbutton", { name: "Currency", exact: true }).fill("-19");
    await page.getByRole("button", { name: "Revert", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency", exact: true })).toHaveValue("12");
    expect(await readFile(f.source)).toEqual(f.before);
    for (const [name, value] of [
      ["Level", "2147483648"],
      ["Currency", "-2147483648"],
      ["Lives", "-1"],
      ["Total Haul", "2147483647"],
    ]) {
      await page.getByRole("spinbutton", { name, exact: true }).fill(value);
    }
    await page.getByRole("combobox", { name: "Resume location" }).click();
    await page.getByRole("option", { name: "Shop / Service Station", exact: true }).click();
    await page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency", exact: true })).toHaveValue(
      "-2147483648",
    );
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("5 pending changes");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.getByTestId("workspace-review")).toContainText("Run · Level");
    await expect(page.getByTestId("workspace-review")).toContainText(
      "Normal → Shop / Service Station",
    );
    for (const [width, height] of [
      [960, 640],
      [1200, 800],
      [1600, 900],
    ]) {
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`run-review-${width}.png`) });
    }
    expect(await readFile(f.source)).toEqual(f.before);
    await page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("No pending changes");
    await exactBackup(f.source, f.before);
    const persisted = await readFile(f.source);
    expect(persisted).not.toEqual(f.before);
    await page.getByRole("button", { name: "Change save", exact: true }).click();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    for (const [name, value] of [
      ["Level", "2147483648"],
      ["Currency", "-2147483648"],
      ["Lives", "-1"],
      ["Total Haul", "2147483647"],
    ]) {
      await expect(page.getByRole("spinbutton", { name, exact: true })).toHaveValue(value);
    }
    await expect(page.getByRole("combobox", { name: "Resume location" })).toContainText(
      "Shop / Service Station",
    );
    const currency = page.getByRole("spinbutton", { name: "Currency", exact: true });
    await currency.fill("8");
    await currency.fill("2147483648");
    await expect(currency).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Save Changes", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Revert all", exact: true }).click();
    await expect(currency).toHaveValue("-2147483648");
    await currency.fill("9");
    await page.getByRole("button", { name: "Change save", exact: true }).click();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(currency).toHaveValue("-2147483648");
    expect(await readFile(f.source)).toEqual(persisted);
  } finally {
    await close(app.child, app.browser);
  }
});

for (const phase of ["before_replace", "after_replace"]) {
  test(`Run writer termination at ${phase} reconciles with shared writer exclusion`, async ({
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
      await openRun(app);
      await app.page.getByRole("spinbutton", { name: "Currency", exact: true }).fill("-19");
      await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      const pid = await phaseStarted(marker, phase);
      execFileSync(
        path.join(process.env["SYSTEMROOT"] ?? "C:\\Windows", "System32/taskkill.exe"),
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
      await expect(
        app.page.getByRole("spinbutton", { name: "Currency", exact: true }),
      ).toBeDisabled();
      const state = await native<{ upgradeSession: string }>(app.page, "test_health_state", {
        saveId: E2E_SAVE_ID,
      });
      const fingerprint = await app.page
        .getByTestId("workspace")
        .getAttribute("data-session-fingerprint");
      for (const [command, changes] of [
        ["test_health_write", { playerId: "111", health: 17 }],
        [
          "test_upgrades_write",
          {
            session: state.upgradeSession,
            upgrades: [{ playerId: "111", key: "playerUpgradeStrength", before: 2, value: 3 }],
          },
        ],
        [
          "test_run_write",
          { session: state.upgradeSession, run: [{ field: "currency", before: 12, value: 20 }] },
        ],
      ] as const) {
        expect(
          await native(app.page, command, {
            request: { saveId: E2E_SAVE_ID, fingerprint, operationId: "d".repeat(32), ...changes },
          }),
        ).toMatchObject({ status: "rejected", reason: "write_recovery_required" });
      }
      await exactBackup(f.source, f.before);
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      await expect(app.page.getByTestId("health-status")).toHaveAttribute(
        "data-phase",
        phase === "before_replace" ? "unchanged" : "saved",
      );
      await expect(app.page.getByRole("spinbutton", { name: "Currency", exact: true })).toHaveValue(
        "-19",
      );
      if (phase === "before_replace") {
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "1 pending change",
        );
        await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
        await expect(
          app.page.getByRole("spinbutton", { name: "Currency", exact: true }),
        ).toHaveValue("12");
        expect(await readFile(f.source)).toEqual(f.before);
      } else
        await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
          "No pending changes",
        );
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("Run intent survives response loss and interrupted recovery across three hosts", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const marker = path.join(f.home, "writer.json");
  const first = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
    REPODITOR_RECOVERY_PHASE: "after_replace",
    REPODITOR_RECOVERY_PHASE_FILE: marker,
  });
  try {
    await openRun(first);
    await first.page.getByRole("spinbutton", { name: "Currency", exact: true }).fill("-19");
    await first.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await phaseStarted(marker, "after_replace");
  } finally {
    await close(first.child, first.browser);
  }
  const applied = await readFile(f.source);
  expect(applied).not.toEqual(f.before);
  const recoveryMarker = path.join(f.home, "recovery.json");
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
    await third.page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(third.page.getByRole("spinbutton", { name: "Currency", exact: true })).toHaveValue(
      "-19",
    );
    expect(await readFile(f.source)).toEqual(applied);
    await exactBackup(f.source, f.before);
  } finally {
    await close(third.child, third.browser);
  }
});

test("native Run rejects forged fields values and previous-session requests", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openRun(app);
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
      run: [{ field: "currency", before: 12, value: -19 }],
    };
    for (const edit of [
      { value: true },
      { value: 1.5 },
      { value: 2147483648 },
      { before: 13 },
      { field: "forged" },
      { field: "resumeLocation", before: "Normal", value: "Unknown (9)" },
    ]) {
      expect(
        await native(app.page, "test_run_write", {
          request: { ...base, run: [{ ...base.run[0], ...edit }] },
        }),
      ).toMatchObject({ status: "rejected" });
    }
    expect(
      await native(app.page, "test_run_write", {
        request: { ...base, run: [...base.run, ...base.run] },
      }),
    ).toMatchObject({ status: "rejected", reason: "invalid_request" });
    expect(
      await native(app.page, "test_run_write", {
        request: { ...base, fingerprint: "f".repeat(64) },
      }),
    ).toMatchObject({ status: "rejected" });
    await native(app.page, "saves_open", { saveId: E2E_SAVE_ID });
    expect(await native(app.page, "test_run_write", { request: base })).toMatchObject({
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

for (const final of ["running", "unknown"]) {
  test(`final ${final} game blocks Run replacement and retains recoverable drafts`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info);
    const app = await launch(f.executable, f.home, {
      REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
      REPODITOR_RECOVERY_FINAL_GAME_STATUS: final,
    });
    try {
      await openRun(app);
      await app.page.getByRole("spinbutton", { name: "Currency", exact: true }).fill("-19");
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
        "1 pending change",
      );
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("Run mixed drafts block partial Save and ordinary hosts retain read-only authority", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openRun(app);
    await app.page.getByRole("spinbutton", { name: "Currency", exact: true }).fill("-19");
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await app.page.getByRole("spinbutton", { name: "Strength for Alpha" }).fill("3");
    await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    await app.page.getByRole("spinbutton", { name: "Current health", exact: true }).fill("17");
    await app.page.getByRole("spinbutton", { name: "Current health", exact: true }).press("Tab");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "3 pending changes",
    );
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    await expect(app.page.getByText(/Save one group at a time/)).toBeVisible();
    expect(await readFile(f.source)).toEqual(f.before);
  } finally {
    await close(app.child, app.browser);
  }
  const ordinary = await fixture(info, true);
  const control = await launch(ordinary.executable, ordinary.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await control.page.getByRole("button", { name: /Open workspace/ }).click();
    await control.page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(
      control.page.getByRole("textbox", { name: "Currency", exact: true }),
    ).toHaveAttribute("readonly");
    await expect(control.page.getByRole("spinbutton")).toHaveCount(0);
    await expect(
      control.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toHaveCount(0);
    const denied = await native(control.page, "test_run_write", { request: {} }).catch(
      (error: unknown) => String(error),
    );
    expect(denied).toMatch(/not found|not allowed|not permitted|denied/i);
    expect(await readFile(ordinary.source)).toEqual(ordinary.before);
  } finally {
    await close(control.child, control.browser);
  }
});
