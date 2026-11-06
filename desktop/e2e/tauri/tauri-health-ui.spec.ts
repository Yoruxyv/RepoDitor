import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  PYTHON_ROOT,
  createRunSaveFixture,
  getPythonExecutable,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import { close, launch, native } from "../support/tauriHarness";

const BASE = "build/recovery-checkpoint/health-ui";
const UI = process.env["REPODITOR_HEALTH_UI_EXECUTABLE"];
type App = Awaited<ReturnType<typeof launch>>;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fixture(info: TestInfo, phase = "") {
  if (!UI)
    throw new Error(
      "REPODITOR_HEALTH_UI_EXECUTABLE must name the explicitly configured synthetic UI host",
    );
  const home = info.outputPath("isolated");
  await mkdir(home, { recursive: true });
  const source = await createRunSaveFixture(home);
  const gameRoot = await createGameFixture(home);
  const executable = path.join(home, "repoditor-preview.exe");
  await cp(path.resolve(DESKTOP_ROOT, UI), executable);
  await cp(
    path.join(DESKTOP_ROOT, BASE, "fault-backend/repoditor-backend"),
    path.join(home, "backend"),
    { recursive: true },
  );
  const before = await readFile(source);
  return {
    home,
    source,
    gameRoot,
    executable,
    before,
    environment: {
      REPODITOR_RECOVERY_PHASE: phase,
      REPODITOR_RECOVERY_PHASE_FILE: path.join(home, "phase.json"),
    },
  };
}

async function openWorkspace(app: App) {
  await app.page.getByRole("button", { name: /Open workspace/ }).click();
  await expect(app.page.getByTestId("workspace")).toBeVisible();
}
async function openPlayers(app: App, editable = true) {
  await openWorkspace(app);
  await app.page.getByRole("tab", { name: "Players", exact: true }).click();
  if (editable)
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "editing");
}
async function openRecovery(app: App, expected = "80 → 17") {
  await openWorkspace(app);
  await app.page.getByRole("tab", { name: "Players", exact: true }).click();
  await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery");
  await expect(app.page.getByTestId("pending-health-edit")).toContainText(expected);
}
async function stage(app: App, health = "17") {
  await app.page.getByRole("spinbutton", { name: "Current health" }).fill(health);
  await app.page.getByRole("spinbutton", { name: "Current health" }).press("Tab");
  await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText("1 pending change");
}
async function backupNames(source: string) {
  return (await readdir(path.dirname(source))).filter((name) => name.includes(".bak-health-"));
}
async function started(home: string, phase: string) {
  let pid = 0;
  await expect
    .poll(async () => {
      try {
        const event = JSON.parse(await readFile(path.join(home, "phase.json"), "utf8")) as {
          phase: string;
          pid: number;
        };
        pid = event.pid;
        return event.phase;
      } catch {
        return "";
      }
    })
    .toBe(phase);
  return pid;
}
async function reaped(pid: number) {
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
        throw error;
      }
    })
    .toBe(true);
}
function data(source: string): Record<string, unknown> {
  return JSON.parse(
    execFileSync(
      getPythonExecutable(),
      [
        "-B",
        "-c",
        "import json,sys; from pathlib import Path; from repo_save_editor.storage.repository import SaveRepository; print(json.dumps(SaveRepository.load(Path(sys.argv[1]))))",
        source,
      ],
      { cwd: PYTHON_ROOT, encoding: "utf8" },
    ),
  ) as Record<string, unknown>;
}
function replaceData(source: string, value: Record<string, unknown>) {
  execFileSync(
    getPythonExecutable(),
    [
      "-B",
      "-c",
      "import json,sys; from pathlib import Path; from repo_save_editor.storage.repository import SaveRepository; p=Path(sys.argv[1]); SaveRepository(p.parent).save_as(p,json.loads(sys.argv[2]))",
      source,
      JSON.stringify(value),
    ],
    { cwd: PYTHON_ROOT },
  );
}
function withHealth(value: Record<string, unknown>, health: number) {
  const expected = structuredClone(value);
  const dictionaries = expected["dictionaryOfDictionaries"] as {
    value: { playerHealth: Record<string, number> };
  };
  dictionaries.value.playerHealth["111"] = health;
  return expected;
}
function request(fingerprint: string, changes = {}) {
  return {
    request: {
      saveId: E2E_SAVE_ID,
      fingerprint,
      playerId: "111",
      health: 17,
      operationId: "f".repeat(32),
      ...changes,
    },
  };
}

test("edits, reverts and saves one player with keyboard access at every desktop size", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const original = data(f.source);
  const app = await launch(f.executable, f.home);
  try {
    await openPlayers(app);
    await stage(app);
    await expect(app.page.getByTestId("health-persisted")).toContainText("80 / 100");
    await app.page.getByRole("button", { name: "Review", exact: true }).focus();
    await app.page.keyboard.press("Enter");
    await expect(app.page.getByTestId("workspace-review")).toBeVisible();
    await expect(app.page.getByTestId("workspace-review")).toContainText("Alpha");
    for (const [width, height] of [
      [1600, 900],
      [1200, 800],
      [960, 640],
    ]) {
      await app.page.setViewportSize({ width, height });
      await app.page
        .getByRole("spinbutton", { name: "Current health" })
        .evaluate((element) => element.scrollIntoView({ block: "center" }));
      expect(
        await app.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await expect(
        app.page.getByRole("button", { name: "Save Changes", exact: true }),
      ).toBeInViewport();
      await app.page.screenshot({ path: info.outputPath(`health-pending-${width}x${height}.png`) });
    }
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backupNames(f.source)).toEqual([]);
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("80");
    expect(await readFile(f.source)).toEqual(f.before);
    await stage(app);
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).focus();
    await app.page.keyboard.press("Enter");
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    await expect(app.page.getByTestId("health-status")).toBeFocused();
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("17");
    expect(data(f.source)).toEqual(withHealth(original, 17));
    const backups = await backupNames(f.source);
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(f.source), backups[0]))).toEqual(f.before);
    expect(await app.page.getByTestId("workspace").getAttribute("data-session-fingerprint")).toBe(
      digest(await readFile(f.source)),
    );
    await app.page.screenshot({ path: info.outputPath("health-saved.png") });
    await writeFile(
      info.outputPath("save-evidence.json"),
      JSON.stringify(
        {
          before: digest(f.before),
          after: digest(await readFile(f.source)),
          backups,
          onlyHealthChanged: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await close(app.child, app.browser);
  }
});

test("invalid input and other domains cannot gain write authority", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home);
  try {
    await openPlayers(app);
    await stage(app);
    await app.page.getByRole("button", { name: /Beta/ }).click();
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toBeEditable();
    await app.page.getByRole("button", { name: /Alpha/ }).click();
    const input = app.page.getByRole("spinbutton", { name: "Current health" });
    await input.fill("1.5");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    await input.fill("17");
    await input.press("Tab");
    for (const invalid of [
      { health: true },
      { health: 1.5 },
      { health: -1 },
      { health: 101 },
      { playerId: "../111" },
      { playerId: "999" },
      { feature: "cosmetics" },
    ]) {
      expect(
        await native(app.page, "test_health_write", request(digest(f.before), invalid)),
      ).toMatchObject({ status: "rejected" });
    }
    for (const command of [
      "saves_write",
      "upgrades_write",
      "run_write",
      "items_write",
      "cosmetics_write",
      "backend_exec",
      "plugin:fs|write_text_file",
      "plugin:shell|execute",
    ]) {
      expect(await native(app.page, command, {}).catch((error: unknown) => String(error))).toMatch(
        /not found|not allowed|not permitted|denied/i,
      );
    }
    await app.page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(app.page.getByRole("textbox", { name: "Currency" })).toHaveAttribute(
      "readonly",
      "",
    );
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backupNames(f.source)).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

test("stale rejection preserves intent and requires an explicit refreshed save", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home);
  try {
    await openPlayers(app);
    await stage(app);
    const changed = data(f.source);
    (changed["teamName"] as { value: string }).value = "External synthetic team";
    replaceData(f.source, changed);
    const external = await readFile(f.source);
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "rejected");
    await expect(app.page.getByTestId("pending-health-edit")).toContainText("80 → 17");
    expect(await readFile(f.source)).toEqual(external);
    expect(await backupNames(f.source)).toEqual([]);
    await app.page.getByRole("button", { name: "Refresh saved values" }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "editing");
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    expect(data(f.source)).toEqual(withHealth(changed, 17));
    const names = await backupNames(f.source);
    expect(names).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(f.source), names[0]))).toEqual(external);
  } finally {
    await close(app.child, app.browser);
  }
});

test("lost response restores durable intent after renderer reload without replay", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "response_error");
  const app = await launch(f.executable, f.home, f.environment);
  try {
    await app.page.setViewportSize({ width: 960, height: 640 });
    await openPlayers(app);
    await app.page.getByRole("button", { name: /Beta/ }).click();
    await stage(app, "40");
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    const status = app.page.getByTestId("health-status");
    await expect(status).toHaveAttribute("data-phase", "recovery");
    await expect(status).toBeFocused();
    await expect(status).toBeInViewport({ ratio: 1 });
    const operation = await status.getAttribute("data-operation-id");
    const after = await readFile(f.source);
    await expect(status).not.toContainText("Original backup verified");
    await app.page.reload();
    await openRecovery(app, "0 → 40");
    await expect(status).toHaveAttribute("data-operation-id", operation!);
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toBeDisabled();
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).focus();
    await app.page.keyboard.press("Enter");
    await expect(status).toHaveAttribute("data-phase", "saved");
    await expect(app.page.getByRole("button", { name: /Beta/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("40");
    expect(await readFile(f.source)).toEqual(after);
    expect(await backupNames(f.source)).toHaveLength(1);
    await writeFile(
      info.outputPath("lost-response.json"),
      JSON.stringify({ operation, reloaded: true, noReplay: true, after: digest(after) }, null, 2),
    );
  } finally {
    await close(app.child, app.browser);
  }
});

test("native timeout preserves intent and keeps the status lane responsive", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "after_replace");
  const app = await launch(f.executable, f.home, f.environment);
  try {
    await openPlayers(app);
    await stage(app);
    const time = performance.now();
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).dblclick();
    const pid = await started(f.home, "after_replace");
    await expect(app.page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    const statusStart = performance.now();
    expect(await native(app.page, "test_health_state", { saveId: E2E_SAVE_ID })).toMatchObject({
      enabled: true,
      state: "busy",
    });
    expect(await native(app.page, "game_status")).toMatchObject({
      ok: true,
      data: { status: "not_running" },
    });
    const statusMs = performance.now() - statusStart;
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saving");
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "recovery", {
      timeout: 35000,
    });
    const timeoutMs = performance.now() - time;
    await reaped(pid);
    await expect(app.page.getByTestId("pending-health-edit")).toContainText("80 → 17");
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    expect(await backupNames(f.source)).toHaveLength(1);
    await writeFile(
      info.outputPath("timeout.json"),
      JSON.stringify({ pid, childReaped: true, statusMs, timeoutMs, noReplay: true }, null, 2),
    );
  } finally {
    await close(app.child, app.browser);
  }
});

for (const resolution of ["save", "revert"] as const) {
  test(`close before replacement restores unchanged intent for explicit ${resolution}`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const f = await fixture(info, "before_replace");
    let app = await launch(f.executable, f.home, f.environment);
    let closed = false;
    try {
      await openPlayers(app);
      await stage(app);
      await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
      const pid = await started(f.home, "before_replace");
      const operation = await app.page
        .getByTestId("health-status")
        .getAttribute("data-operation-id");
      const unrelated = path.join(path.dirname(f.source), ".unrelated.tmp");
      await writeFile(unrelated, "not operation-owned");
      await close(app.child, app.browser);
      closed = true;
      await reaped(pid);
      expect(await readFile(f.source)).toEqual(f.before);
      app = await launch(f.executable, f.home);
      closed = false;
      await openRecovery(app);
      await expect(app.page.getByTestId("health-status")).toHaveAttribute(
        "data-operation-id",
        operation!,
      );
      await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
      await expect(app.page.getByTestId("health-status")).toHaveAttribute(
        "data-phase",
        "unchanged",
      );
      expect(await readFile(f.source)).toEqual(f.before);
      expect(await backupNames(f.source)).toHaveLength(1);
      expect(await readFile(unrelated, "utf8")).toBe("not operation-owned");
      expect(
        (await readdir(path.dirname(f.source))).filter(
          (name) => name.startsWith(".") && name.includes(".health-") && name.endsWith(".tmp"),
        ),
      ).toEqual([]);
      if (resolution === "save") {
        await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
        await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
        expect(await backupNames(f.source)).toHaveLength(2);
      } else {
        await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
        await expect(app.page.getByTestId("health-status")).toHaveAttribute(
          "data-phase",
          "editing",
        );
        await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveValue(
          "80",
        );
        expect(await readFile(f.source)).toEqual(f.before);
        expect(await backupNames(f.source)).toHaveLength(1);
      }
      await writeFile(
        info.outputPath("unchanged-restart.json"),
        JSON.stringify(
          { operation, pid, childReaped: true, resolution, unrelatedTemporaryPreserved: true },
          null,
          2,
        ),
      );
    } finally {
      if (!closed) await close(app.child, app.browser);
    }
  });
}

test("a matching health value cannot hide an external conflict", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "before_replace");
  let app = await launch(f.executable, f.home, f.environment);
  let closed = false;
  try {
    await openPlayers(app);
    await stage(app);
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    const pid = await started(f.home, "before_replace");
    await close(app.child, app.browser);
    closed = true;
    await reaped(pid);
    const changed = withHealth(data(f.source), 17);
    (changed["teamName"] as { value: string }).value = "External synthetic owner";
    replaceData(f.source, changed);
    const external = await readFile(f.source);
    app = await launch(f.executable, f.home);
    closed = false;
    await openRecovery(app);
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "conflict");
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    await expect(app.page.getByRole("button", { name: "Revert all", exact: true })).toBeDisabled();
    await expect(app.page.getByTestId("pending-health-edit")).toContainText("80 → 17");
    expect(await readFile(f.source)).toEqual(external);
    expect(await backupNames(f.source)).toHaveLength(1);
    expect(
      (await readdir(path.dirname(f.source))).some(
        (name) => name.includes(".health-") && name.endsWith(".tmp"),
      ),
    ).toBe(true);
    await app.page.screenshot({ path: info.outputPath("health-conflict.png") });
  } finally {
    if (!closed) await close(app.child, app.browser);
  }
});

test("interrupted reconciliation resumes after another application restart", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, "after_replace");
  let app = await launch(f.executable, f.home, f.environment);
  let closed = false;
  try {
    await openPlayers(app);
    await stage(app);
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    let pid = await started(f.home, "after_replace");
    await close(app.child, app.browser);
    closed = true;
    await reaped(pid);
    app = await launch(f.executable, f.home, {
      ...f.environment,
      REPODITOR_RECOVERY_PHASE: "recovery_archive",
    });
    closed = false;
    await openRecovery(app);
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    pid = await started(f.home, "recovery_archive");
    await expect(app.page.getByTestId("health-status")).toHaveAttribute(
      "data-phase",
      "reconciling",
    );
    await close(app.child, app.browser);
    closed = true;
    await reaped(pid);
    const current = await readFile(f.source);
    app = await launch(f.executable, f.home);
    closed = false;
    await openRecovery(app);
    await app.page.getByRole("button", { name: "Reconcile changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    expect(await readFile(f.source)).toEqual(current);
    expect(await backupNames(f.source)).toHaveLength(1);
    await writeFile(
      info.outputPath("recovery-restart.json"),
      JSON.stringify({ pid, childReaped: true, noReplay: true, after: digest(current) }, null, 2),
    );
  } finally {
    if (!closed) await close(app.child, app.browser);
  }
});

test("running and unknown game status reject native writes", async ({ browserName }, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  let app = await launch(f.executable, f.home);
  let closed = false;
  let game: ReturnType<typeof spawn> | undefined;
  try {
    await openPlayers(app);
    await stage(app);
    game = spawn(path.join(f.gameRoot, "REPO.exe"), ["-e", "setInterval(()=>{},1000)"], {
      cwd: f.gameRoot,
      stdio: "ignore",
      windowsHide: true,
    });
    await once(game, "spawn");
    await app.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(app.page.getByRole("dialog")).toBeVisible();
    expect(await native(app.page, "test_health_write", request(digest(f.before)))).toMatchObject({
      status: "rejected",
      reason: "game_running",
    });
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backupNames(f.source)).toEqual([]);
    const exited = once(game, "exit");
    game.kill();
    await exited;
    game = undefined;
    await close(app.child, app.browser);
    closed = true;
    app = await launch(f.executable, f.home, { REPODITOR_RECOVERY_SYNTHETIC_STATUS: "unknown" });
    closed = false;
    await openWorkspace(app);
    await expect(app.page.getByRole("dialog")).toBeVisible();
    expect(await native(app.page, "test_health_write", request(digest(f.before)))).toMatchObject({
      status: "rejected",
      reason: "game_status_unknown",
    });
    expect(await readFile(f.source)).toEqual(f.before);
    expect(await backupNames(f.source)).toEqual([]);
  } finally {
    if (game?.exitCode === null) {
      const exited = once(game, "exit");
      game.kill();
      await exited;
    }
    if (!closed) await close(app.child, app.browser);
  }
});

for (const variant of ["default", "ui-without-permissions", "protocol"] as const) {
  test(`${variant} keeps the health UI unavailable`, async ({ browserName }, info) => {
    expect(browserName).toBe("chromium");
    const executable = {
      default: process.env["REPODITOR_HEALTH_DEFAULT_EXECUTABLE"],
      protocol: process.env["REPODITOR_HEALTH_PROTOCOL_EXECUTABLE"],
      "ui-without-permissions": process.env["REPODITOR_HEALTH_NO_PERMISSION_EXECUTABLE"],
    }[variant];
    if (!executable) throw new Error(`Missing ${variant} executable`);
    const f = await fixture(info);
    await cp(path.resolve(DESKTOP_ROOT, executable), f.executable);
    const app = await launch(f.executable, f.home);
    try {
      await openPlayers(app, false);
      await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveAttribute(
        "readonly",
        "",
      );
      await expect(app.page.getByTestId("health-status")).toHaveCount(0);
      if (variant === "protocol") {
        expect(await native(app.page, "test_health_state", { saveId: E2E_SAVE_ID })).toMatchObject({
          enabled: false,
          state: "disabled",
        });
      } else {
        for (const command of ["test_health_write", "test_health_recover", "test_health_state"]) {
          expect(
            await native(
              app.page,
              command,
              command === "test_health_state" ? { saveId: E2E_SAVE_ID } : request(digest(f.before)),
            ).catch((error: unknown) => String(error)),
          ).toMatch(/not found|not allowed|not permitted|denied/i);
        }
      }
      expect(await readFile(f.source)).toEqual(f.before);
      expect(await backupNames(f.source)).toEqual([]);
    } finally {
      await close(app.child, app.browser);
    }
  });
}

test("a synthetic root outside the compiled fence cannot enable the UI or writes", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const outside = path.join(
    DESKTOP_ROOT,
    "build",
    "health-ui-rejected-root",
    path.basename(info.outputDir),
  );
  await mkdir(outside, { recursive: true });
  const source = await createRunSaveFixture(outside);
  await createGameFixture(outside);
  const before = await readFile(source);
  const app = await launch(f.executable, outside);
  try {
    await openPlayers(app, false);
    await expect(app.page.getByRole("spinbutton", { name: "Current health" })).toHaveAttribute(
      "readonly",
      "",
    );
    expect(await native(app.page, "test_health_state", { saveId: E2E_SAVE_ID })).toMatchObject({
      enabled: false,
    });
    expect(await native(app.page, "test_health_write", request(digest(before)))).toMatchObject({
      status: "rejected",
      reason: "invalid_request",
    });
    expect(await readFile(source)).toEqual(before);
    expect(await backupNames(source)).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});
