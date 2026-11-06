import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  PYTHON_ROOT,
  createRunSaveFixture,
  getPythonExecutable,
  isolatedApplicationEnvironment,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import {
  close,
  launch,
  native,
  stageSyntheticBackend,
  stopSyntheticGame,
} from "../support/tauriHarness";
import { waitForWorkspaceOrContinue } from "../support/waits";
import type {
  DesktopOperationResult,
  GameProcessState,
  PlayerDto,
  SaveOpenResult,
} from "../../electron/contracts.cjs";

test("packaged native discovery preserves the read-only contract and refresh", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("profile");
  await mkdir(home, { recursive: true });
  const savePath = await createRunSaveFixture(home);
  await createGameFixture(home);
  const original = createHash("sha256")
    .update(await readFile(savePath))
    .digest("hex");
  const executable = path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!);
  const { child, browser, page } = await launch(executable, home);
  try {
    const open = page.getByRole("button", { name: /Open workspace/ });
    await expect(open).toBeEnabled({ timeout: 15_000 });
    await expect(
      page.getByText("Read-only preview. Editing and saving are unavailable."),
    ).toBeVisible();
    const boundary = await page.evaluate(async () => {
      const native = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (command: string, args?: object) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      const denied = [];
      for (const command of [
        "saves_write",
        "players_write",
        "upgrades_write",
        "run_write",
        "advanced_write",
        "players_avatar",
        "plugin:fs|read_file",
        "plugin:shell|execute",
        "plugin:webview|create_webview_window",
      ]) {
        try {
          await native.invoke(command, {
            path: "C:/Windows/win.ini",
            options: { label: "forbidden", url: "https://example.com" },
          });
          denied.push(false);
        } catch {
          denied.push(true);
        }
      }
      return { node: typeof window.require, electron: typeof window.repoditor, denied };
    });
    expect(boundary).toEqual({
      node: "undefined",
      electron: "undefined",
      denied: [true, true, true, true, true, true, true, true, true],
    });
    for (const size of [
      { width: 1600, height: 900 },
      { width: 1200, height: 800 },
      { width: 960, height: 640 },
    ]) {
      await page.setViewportSize(size);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await rename(savePath, `${savePath}.hidden`);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No valid saves yet" })).toBeVisible();
    await rename(`${savePath}.hidden`, savePath);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(open).toBeEnabled();
    await page.screenshot({ path: info.outputPath("discovery.png") });
    expect(
      createHash("sha256")
        .update(await readFile(savePath))
        .digest("hex"),
    ).toBe(original);
  } finally {
    await close(child, browser);
  }
});

test("a missing packaged backend yields the existing failure and retry UI", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("missing-backend");
  await mkdir(home, { recursive: true });
  const executable = path.join(home, "repoditor-preview.exe");
  await copyFile(path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!), executable);
  const { child, browser, page } = await launch(executable, home);
  try {
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("repoditor-backend.exe");
  } finally {
    await close(child, browser);
  }
});

test("normal close cancels an in-flight discovery and its descendants", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("closing-backend");
  const backend = path.join(home, "backend");
  await mkdir(backend, { recursive: true });
  const executable = path.join(home, "repoditor-preview.exe");
  await copyFile(path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!), executable);
  await copyFile(
    path.join(DESKTOP_ROOT, "src-tauri/target/test-fixtures/sidecar.exe"),
    path.join(backend, "repoditor-backend.exe"),
  );
  const pidFile = path.join(home, "pids.json");
  const { child, browser, page } = await launch(executable, home, {
    REPODITOR_TEST_PID_FILE: pidFile,
  });
  let pids: number[] = [];
  try {
    await expect
      .poll(async () => {
        try {
          pids = JSON.parse(await readFile(pidFile, "utf8")) as number[];
          return pids.length;
        } catch {
          return 0;
        }
      })
      .toBe(2);
    const duplicate = await page.evaluate(async () => {
      const native = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      return native.invoke("environment_detect");
    });
    expect(duplicate).toMatchObject({ ok: false, error: { code: "process_failed" } });
  } finally {
    await close(child, browser);
  }
  await expect
    .poll(() =>
      pids.every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ESRCH";
        }
      }),
    )
    .toBe(true);
});

test("save-open failure recovery and unknown game states remain fail closed", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("synthetic-backend");
  const fixture = await stageSyntheticBackend(home);
  const { child, browser, page } = await launch(fixture.executable, home, fixture.environment);
  try {
    for (const [payload, code] of [
      ["{", "malformed_response"],
      ["exit7", "process_failed"],
      [
        JSON.stringify({
          ...fixture.opened,
          session: { ...fixture.opened.session, id: "REPO_SAVE_2026_08_08_10_20_31" },
        }),
        "invalid_response",
      ],
      [
        JSON.stringify({ ok: false, error: { code: "save_stale", message: "private raw path" } }),
        "save_stale",
      ],
    ] as const) {
      await writeFile(path.join(home, "saves-open.json"), payload);
      await page.getByRole("button", { name: /Open workspace/ }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("button", { name: /Open workspace/ })).toBeEnabled();
      expect(await native(page, "saves_open", { saveId: E2E_SAVE_ID })).toMatchObject({
        ok: false,
        error: { code },
      });
      expect(await page.locator("body").innerText()).not.toContain("private");
      await expect(page.getByTestId("workspace")).toHaveCount(0);
    }
    for (const saveId of ["../save.es3", "C:/save.es3", "--help", null, 42]) {
      expect(await native(page, "saves_open", { saveId })).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(await native(page, "saves_open")).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    await writeFile(path.join(home, "saves-open.json"), JSON.stringify(fixture.opened));
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "unknown", running: false }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "RepoDitor could not verify that R.E.P.O. is closed." }),
    ).toBeVisible();
    await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "");
    expect(await native(page, "game_status")).toEqual({
      ok: true,
      data: { status: "unknown", running: false },
    });
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "running", running: true }),
    );
    await page.getByRole("button", { name: "Check Again" }).click();
    await expect(
      page.getByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeVisible();
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "not_running", running: false }),
    );
    await page.getByRole("button", { name: "Check Again" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "unknown", running: true }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Exit RepoDitor" }).click();
    await expect.poll(() => child.exitCode).toBe(0);
  } finally {
    await close(child, browser);
  }
});

for (const [command, feature] of [
  ["saves-open", "Overview"],
  ["players-list", "Players"],
  ["upgrades-list", "Upgrades"],
  ["run-get", "Run"],
  ["advanced-get", "Items"],
] as const)
  test(`closing during ${command} reclaims its backend and descendant`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const home = info.outputPath("cancel-open");
    const fixture = await stageSyntheticBackend(home);
    const pidFile = path.join(home, "pids.json");
    const { child, browser, page } = await launch(fixture.executable, home, {
      ...fixture.environment,
      REPODITOR_TEST_HANG_COMMAND: command,
      REPODITOR_TEST_PID_FILE: pidFile,
    });
    let pids: number[] = [];
    try {
      await page.getByRole("button", { name: /Open workspace/ }).click();
      await expect
        .poll(async () => {
          try {
            pids = JSON.parse(await readFile(pidFile, "utf8")) as number[];
            return pids.length;
          } catch {
            return 0;
          }
        })
        .toBe(2);
      if (command !== "saves-open") {
        await page.getByRole("tab", { name: feature }).click();
        await expect(page.getByTestId(`${feature.toLowerCase()}-skeleton`)).toBeVisible();
      }
      expect(await native(page, command.replace("-", "_"), { saveId: E2E_SAVE_ID })).toMatchObject({
        ok: false,
        error: { code: "process_failed" },
      });
    } finally {
      await close(child, browser);
    }
    await expect
      .poll(() =>
        pids.every((pid) => {
          try {
            process.kill(pid, 0);
            return false;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code === "ESRCH";
          }
        }),
      )
      .toBe(true);
  });

test("Players validates failures, empty data and retry while game status remains fail closed", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("player-failures");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "players-list.json");
  const healthy = await readFile(response, "utf8");
  await writeFile(response, "exit7");
  const { child, browser, page } = await launch(fixture.executable, home, fixture.environment);
  try {
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    for (const saveId of [null, 42, "../save.es3", "--help", "REPO_SAVE_2026_08_08_10_20_30\n"]) {
      expect(await native(page, "players_list", { saveId })).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(await native(page, "players_list")).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    for (const [payload, code] of [
      ["{", "malformed_response"],
      [JSON.stringify({ ok: true }), "invalid_response"],
      [
        JSON.stringify({
          ok: true,
          players: [{ id: "../111", name: "Alpha", health: 80, maxHealth: 100 }],
        }),
        "invalid_response",
      ],
      [
        JSON.stringify({ ok: false, error: { code: "save_missing", message: "private raw path" } }),
        "save_missing",
      ],
    ]) {
      await writeFile(response, payload);
      expect(await native(page, "players_list", { saveId: E2E_SAVE_ID })).toMatchObject({
        ok: false,
        error: { code },
      });
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("private");
    }
    await writeFile(response, healthy);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("button", { name: /Beta/ })).toBeVisible();
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByTestId("selected-player-identity")).toContainText("222");
    for (const payload of [
      JSON.stringify({ ok: true, status: "unknown", running: false }),
      "exit7",
    ]) {
      await writeFile(path.join(home, "game-status.json"), payload);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "");
      await writeFile(
        path.join(home, "game-status.json"),
        JSON.stringify({ ok: true, status: "not_running", running: false }),
      );
      await page.getByRole("button", { name: "Check Again" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByTestId("selected-player-identity")).toContainText("Beta");
    }
    await writeFile(response, JSON.stringify({ ok: true, players: [] }));
    await page.getByRole("button", { name: "Change save" }).click();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("heading", { name: "No players found" })).toBeVisible();
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
  } finally {
    await close(child, browser);
  }
});

for (const [feature, command] of [
  ["Players", "players-list"],
  ["Upgrades", "upgrades-list"],
  ["Run", "run-get"],
  ["Items", "advanced-get"],
] as const)
  test(`${feature} deadline reclaims descendants and allows retry`, async ({
    browserName,
  }, info) => {
    expect(browserName).toBe("chromium");
    const home = info.outputPath("player-timeout");
    const fixture = await stageSyntheticBackend(home);
    const response = path.join(home, `${command}.json`);
    const healthy = await readFile(response, "utf8");
    const pidFile = path.join(home, "pids.json");
    await writeFile(response, "hang");
    const { child, browser, page } = await launch(fixture.executable, home, {
      ...fixture.environment,
      REPODITOR_TEST_PID_FILE: pidFile,
    });
    try {
      await page.getByRole("button", { name: /Open workspace/ }).click();
      await page.getByRole("tab", { name: feature }).click();
      await expect(page.getByTestId(`${feature.toLowerCase()}-skeleton`)).toBeVisible();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 35_000 });
      const pids = JSON.parse(await readFile(pidFile, "utf8")) as number[];
      expect(pids).toHaveLength(2);
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
      await writeFile(response, healthy);
      await page.getByRole("button", { name: "Try again" }).click();
      if (feature === "Players")
        await expect(page.getByRole("button", { name: /Alpha/ })).toBeVisible();
      else if (feature === "Upgrades")
        await expect(page.getByRole("textbox", { name: "Strength for Alpha" })).toHaveValue("2");
      else if (feature === "Run")
        await expect(page.getByRole("textbox", { name: "Currency" })).toHaveValue("12");
      else
        await expect(
          page.getByTestId("item-instance-Item Melee Inflatable Hammer/1"),
        ).toContainText("Current charge: 99");
    } finally {
      await close(child, browser);
    }
  });

async function comparePlayers(page: Page, electronPage: Page, info: TestInfo) {
  await page.getByRole("tab", { name: "Players" }).click();
  await electronPage.getByRole("tab", { name: "Players" }).click();
  await expect(page.getByRole("button", { name: /Alpha/ })).toHaveAttribute("aria-pressed", "true");
  await expect(electronPage.getByRole("button", { name: /Alpha/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const samples: Record<string, number> = {};
  for (const [host, target] of [
    ["tauri", page],
    ["electron", electronPage],
  ] as const) {
    const started = performance.now();
    const result =
      host === "tauri"
        ? await Promise.all([
            native(target, "players_list", { saveId: E2E_SAVE_ID }),
            native(target, "game_status"),
          ])
        : await Promise.all([
            target.evaluate((id) => window.repoditor.players.list(id), E2E_SAVE_ID),
            target.evaluate(() => window.repoditor.game.status()),
          ]);
    samples[`${host}ConcurrentReadsMs`] = performance.now() - started;
    expect(result[0]).toMatchObject({ ok: true });
    expect(result[1]).toEqual({ ok: true, data: { status: "not_running", running: false } });
  }
  await info.attach("players-concurrent-read-timings", {
    body: JSON.stringify(samples),
    contentType: "application/json",
  });
  await writeFile(info.outputPath("players-concurrent-read-timings.json"), JSON.stringify(samples));
  expect(await native(page, "players_list", { saveId: E2E_SAVE_ID })).toEqual(
    await electronPage.evaluate((id) => window.repoditor.players.list(id), E2E_SAVE_ID),
  );
  for (const name of ["Beta", "Alpha"]) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await electronPage.getByRole("button", { name: new RegExp(name) }).click();
    expect(await page.getByTestId("selected-player-identity").innerText()).toBe(
      await electronPage.getByTestId("selected-player-identity").innerText(),
    );
    await expect(page.getByRole("spinbutton")).toHaveValue(
      await electronPage.getByRole("spinbutton").inputValue(),
    );
    expect(await page.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      await electronPage.getByRole("progressbar").getAttribute("aria-valuenow"),
    );
  }
  await expect(page.getByRole("spinbutton")).toHaveAttribute("readonly", "");
  await page.getByRole("spinbutton").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("spinbutton")).toHaveValue("80");
  await expect(page.getByRole("button", { name: "Heal to Full" })).toHaveCount(0);
  await expect(page.getByTestId("avatar-fallback")).toBeVisible();
  await expect(page.getByTestId("avatar-fallback-loading")).toHaveCount(0);
  for (const size of [
    { width: 1600, height: 900 },
    { width: 1200, height: 800 },
    { width: 960, height: 640 },
  ]) {
    for (const target of [page, electronPage]) {
      await target.setViewportSize(size);
      expect(
        await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`native-players-${size.width}.png`) });
    await electronPage.screenshot({
      path: info.outputPath(`electron-players-${size.width}.png`),
    });
  }
}

async function compareEmptyAndInvalidPlayers(page: Page, electronPage: Page, savePath: string) {
  await page.getByRole("tab", { name: "Players" }).click();
  await expect(page.getByRole("spinbutton")).toHaveValue("55");
  for (const mode of ["empty", "invalid"]) {
    execFileSync(
      getPythonExecutable(),
      [
        "-c",
        "import json,sys; from pathlib import Path; from repo_save_editor.core.crypto import encrypt_save; data=json.loads(Path(sys.argv[1]).read_text()); data['playerNames']['value']={} if sys.argv[3]=='empty' else {'invalid':'Broken'}; Path(sys.argv[2]).write_bytes(encrypt_save(data))",
        path.join(DESKTOP_ROOT, "e2e/fixtures/save.json"),
        savePath,
        mode,
      ],
      { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT } },
    );
    const source = await readFile(savePath);
    const actual = await native(page, "players_list", { saveId: E2E_SAVE_ID });
    expect(actual).toEqual(
      await electronPage.evaluate((id) => window.repoditor.players.list(id), E2E_SAVE_ID),
    );
    expect(actual).toEqual(
      mode === "empty"
        ? { ok: true, data: [] }
        : {
            ok: false,
            error: {
              code: "invalid_response",
              message: "The Python player response did not match the desktop contract.",
            },
          },
    );
    for (const target of [page, electronPage]) {
      await target.getByRole("button", { name: "Change save" }).click();
      await target.getByRole("button", { name: /Open workspace/ }).click();
      if (target === electronPage) await waitForWorkspaceOrContinue(target);
      await target.getByRole("tab", { name: "Players" }).click();
      if (mode === "empty")
        await expect(target.getByRole("heading", { name: "No players found" })).toBeVisible();
      else await expect(target.getByRole("alert")).toBeVisible();
      await expect(target.getByRole("spinbutton")).toHaveCount(0);
    }
    expect(await readFile(savePath)).toEqual(source);
  }
}

test("frozen-backend Overview and Players match Electron and read changed or missing saves safely", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("comparison");
  await mkdir(home, { recursive: true });
  const savePath = await createRunSaveFixture(home);
  const gameRoot = await createGameFixture(home);
  const original = await readFile(savePath);
  const referenceEnvironment = isolatedApplicationEnvironment(
    home,
    path.join(home, "AppData/LocalLow"),
  );
  referenceEnvironment["REPODITOR_E2E_STEAM_ROOT"] = path.join(home, "SteamLibrary");
  // Local reference package is a prerequisite; never silently skip the comparison.
  const reference = await electron.launch({
    executablePath: path.join(DESKTOP_ROOT, "release/win-unpacked/RepoDitor.exe"),
    args: ["--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
    env: referenceEnvironment,
  });
  let preview: Awaited<ReturnType<typeof launch>> | undefined;
  let syntheticGame: ChildProcess | undefined;
  try {
    preview = await launch(
      path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!),
      home,
    );
    const { page } = preview;
    const electronPage = await reference.firstWindow();
    const expected = await electronPage.evaluate(
      (saveId) => window.repoditor.saves.open(saveId),
      E2E_SAVE_ID,
    );
    const opened = await native<DesktopOperationResult<SaveOpenResult>>(page, "saves_open", {
      saveId: E2E_SAVE_ID,
    });
    expect(expected.ok).toBe(true);
    expect(opened.ok).toBe(true);
    if (!expected.ok || !opened.ok)
      throw new Error("Read-only comparison could not open its synthetic save");
    expect(opened.data.session).toEqual(expected.data.session);
    expect(opened.data.requiredUpgradeVisualKeys).toEqual(expected.data.requiredUpgradeVisualKeys);
    expect(await native(page, "game_status")).toEqual(
      await electronPage.evaluate(() => window.repoditor.game.status()),
    );
    await electronPage.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(electronPage);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
    const metrics = 'section[aria-labelledby="run-snapshot-title"] dl';
    expect(await page.locator(metrics).innerText()).toBe(
      await electronPage.locator(metrics).innerText(),
    );
    await comparePlayers(page, electronPage, info);
    syntheticGame = spawn(path.join(gameRoot, "REPO.exe"), ["-e", "setInterval(() => {}, 1000)"], {
      cwd: gameRoot,
      stdio: "ignore",
      windowsHide: true,
    });
    await once(syntheticGame, "spawn", { signal: AbortSignal.timeout(5000) });
    await expect
      .poll(async () => native<DesktopOperationResult<GameProcessState>>(page, "game_status"))
      .toEqual({ ok: true, data: { status: "running", running: true } });
    expect(await electronPage.evaluate(() => window.repoditor.game.status())).toEqual({
      ok: true,
      data: { status: "running", running: true },
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await electronPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeVisible();
    await expect(
      electronPage.getByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeVisible();
    await stopSyntheticGame(syntheticGame);
    await page.getByRole("button", { name: "Check Again" }).click();
    await electronPage.getByRole("button", { name: "Check Again" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(electronPage.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("tab", { name: "Overview" }).click();
    await electronPage.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save Changes" })).toHaveCount(0);
    const destinations = page.getByRole("button", { name: /^Open (Players|Upgrades|Run|Items)$/ });
    await expect(destinations).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Open Players" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Open Upgrades" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Open Run" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Open Items" })).toBeEnabled();
    for (const size of [
      { width: 1600, height: 900 },
      { width: 1200, height: 800 },
      { width: 960, height: 640 },
    ]) {
      await page.setViewportSize(size);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath("native-overview.png") });
    await electronPage.screenshot({ path: info.outputPath("electron-overview.png") });
    expect(await readFile(savePath)).toEqual(original);
    await page.getByRole("button", { name: "Change save" }).click();
    await expect(page.getByRole("button", { name: /Open workspace/ })).toBeVisible();
    // An external change after discovery is read afresh, as in Electron; no stale cached DTO.
    execFileSync(
      getPythonExecutable(),
      [
        "-c",
        "import json,sys; from pathlib import Path; from repo_save_editor.core.crypto import encrypt_save; data=json.loads(Path(sys.argv[1]).read_text()); data['dictionaryOfDictionaries']['value']['runStats']['currency']=37; data['dictionaryOfDictionaries']['value']['playerHealth']['111']=55; Path(sys.argv[2]).write_bytes(encrypt_save(data))",
        path.join(DESKTOP_ROOT, "e2e/fixtures/save.json"),
        savePath,
      ],
      { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT } },
    );
    const changed = await readFile(savePath);
    const latest = await native<DesktopOperationResult<SaveOpenResult>>(page, "saves_open", {
      saveId: E2E_SAVE_ID,
    });
    const electronLatest = await electronPage.evaluate(
      (id) => window.repoditor.saves.open(id),
      E2E_SAVE_ID,
    );
    expect(latest.ok).toBe(true);
    expect(electronLatest.ok).toBe(true);
    if (!latest.ok || !electronLatest.ok) throw new Error("Updated fixture could not reopen");
    expect(latest.data.session).toEqual(electronLatest.data.session);
    expect(latest.data.session.currency).toBe(37);
    expect(latest.data.session.fingerprint).not.toBe(opened.data.session.fingerprint);
    const changedPlayers = await native<DesktopOperationResult<PlayerDto[]>>(page, "players_list", {
      saveId: E2E_SAVE_ID,
    });
    expect(changedPlayers).toEqual(
      await electronPage.evaluate((id) => window.repoditor.players.list(id), E2E_SAVE_ID),
    );
    expect(changedPlayers).toMatchObject({
      ok: true,
      data: [
        { id: "111", health: 55 },
        { id: "222", health: 0 },
      ],
    });
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.locator(metrics)).toContainText("37");
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("spinbutton")).toHaveValue("55");
    await page.getByRole("button", { name: "Change save" }).click();
    await expect(page.getByRole("button", { name: /Open workspace/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    await rename(savePath, `${savePath}.hidden`);
    expect(await native(page, "players_list", { saveId: E2E_SAVE_ID })).toEqual(
      await electronPage.evaluate((id) => window.repoditor.players.list(id), E2E_SAVE_ID),
    );
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.getByRole("alert")).toContainText("The selected save could not be found.");
    expect(await native(page, "saves_open", { saveId: E2E_SAVE_ID })).toEqual(
      await electronPage.evaluate((id) => window.repoditor.saves.open(id), E2E_SAVE_ID),
    );
    await rename(`${savePath}.hidden`, savePath);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.locator(metrics)).toContainText("37");
    expect(await readFile(savePath)).toEqual(changed);
    await compareEmptyAndInvalidPlayers(page, electronPage, savePath);
  } finally {
    try {
      await stopSyntheticGame(syntheticGame);
    } finally {
      try {
        if (preview) await close(preview.child, preview.browser);
      } finally {
        await reference.close();
      }
    }
  }
});
