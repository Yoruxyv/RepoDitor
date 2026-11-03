import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  _electron as electron,
  chromium,
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";

import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  PYTHON_ROOT,
  createRunSaveFixture,
  getPythonExecutable,
  isolatedApplicationEnvironment,
} from "./support/fixtureEnvironment";
import { createGameFixture } from "./support/harness";
import { waitForWorkspaceOrContinue } from "./support/waits";
import type {
  DesktopOperationResult,
  GameProcessState,
  SaveOpenResult,
} from "../electron/contracts.cjs";

async function native<T>(page: Page, command: string, args?: Record<string, unknown>): Promise<T> {
  return page.evaluate(
    async ({ command, args }) => {
      const bridge = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (name: string, args?: object) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      return bridge.invoke(command, args);
    },
    { command, args },
  ) as Promise<T>;
}

async function stageSyntheticBackend(home: string) {
  await mkdir(path.join(home, "backend"), { recursive: true });
  const executable = path.join(home, "repoditor-preview.exe");
  await copyFile(path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!), executable);
  await copyFile(
    path.join(DESKTOP_ROOT, "src-tauri/target/test-fixtures/sidecar.exe"),
    path.join(home, "backend/repoditor-backend.exe"),
  );
  const save = {
    id: E2E_SAVE_ID,
    displayName: "Synthetic save",
    path: "C:/fixture/save.es3",
    lastModified: "2026-11-03T00:00:00+00:00",
    fileSize: 123,
  };
  const opened = {
    ok: true,
    session: {
      ...save,
      fingerprint: "a".repeat(64),
      level: 5,
      currency: 12,
      playerCount: 2,
      resumeLocation: "Normal",
    },
    requiredUpgradeVisualKeys: [],
  };
  await writeFile(
    path.join(home, "environment.json"),
    JSON.stringify({
      ok: true,
      saveRoot: "C:/fixture",
      saveRootStatus: "available",
      saveRootDetected: true,
      saveCount: 1,
      saves: [save],
      gameRoot: null,
      gameStatus: "game_not_found",
      gameDetected: false,
    }),
  );
  await writeFile(path.join(home, "saves-open.json"), JSON.stringify(opened));
  await writeFile(
    path.join(home, "game-status.json"),
    JSON.stringify({ ok: true, status: "not_running", running: false }),
  );
  return {
    executable,
    opened,
    environment: { REPODITOR_TEST_RESPONSES_DIR: home, REPODITOR_TEST_HANG_COMMAND: "none" },
  };
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No local debug port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function launch(
  executable: string,
  home: string,
  extraEnvironment: Record<string, string> = {},
) {
  const port = await freePort();
  const environment = isolatedApplicationEnvironment(home, path.join(home, "AppData", "LocalLow"));
  // WebView2 needs the real Windows profile identity; actual data paths remain isolated.
  environment["USERPROFILE"] = process.env["USERPROFILE"] ?? home;
  environment["REPODITOR_E2E_STEAM_ROOT"] = path.join(home, "SteamLibrary");
  environment["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] =
    `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`;
  environment["WEBVIEW2_REMOTE_DEBUGGING_PORT"] = String(port);
  environment["PATH"] = `${process.env["SYSTEMROOT"]}\\System32;${process.env["SYSTEMROOT"]}`;
  Object.assign(environment, extraEnvironment);
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: environment,
    windowsHide: false,
    stdio: "ignore",
  });
  let browser: Browser | undefined;
  try {
    const deadline = performance.now() + 20_000;
    while (performance.now() < deadline) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
        break;
      } catch {
        if (child.exitCode !== null) throw new Error("Preview exited before becoming available");
        await delay(100);
      }
    }
    if (!browser) throw new Error("Preview WebView2 did not become available");
    const page = browser.contexts().flatMap((context) => context.pages())[0];
    if (!page) throw new Error("Preview page missing");
    return { child, browser, page };
  } catch (error) {
    child.kill();
    await browser?.close();
    throw error;
  }
}

async function close(child: ChildProcess, browser: Browser) {
  const initialExitCode = child.exitCode;
  if (initialExitCode !== null) {
    await browser.close();
    expect(initialExitCode).toBe(0);
    return;
  }
  if (!child.pid) throw new Error("Preview PID missing");
  execFileSync(
    getPythonExecutable(),
    [path.join(DESKTOP_ROOT, "e2e/support/close-preview.py"), String(child.pid)],
    { windowsHide: true },
  );
  for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(25);
  await browser.close();
  if (child.exitCode === null) {
    child.kill();
    throw new Error("Preview did not shut down normally");
  }
  expect(child.exitCode).toBe(0);
}

async function stopSyntheticGame(child: ChildProcess | undefined) {
  if (child?.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "close", { signal: AbortSignal.timeout(5000) });
  if (!child.kill()) throw new Error("Synthetic game could not be stopped");
  await exited;
}

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
      denied: [true, true, true, true],
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

test("closing during save-open reclaims its backend and descendant", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("cancel-open");
  const fixture = await stageSyntheticBackend(home);
  const pidFile = path.join(home, "pids.json");
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_HANG_COMMAND: "saves-open",
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
    expect(await native(page, "saves_open", { saveId: E2E_SAVE_ID })).toMatchObject({
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

test("frozen-backend Overview matches Electron and reopens changed or missing saves safely", async ({
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
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save Changes" })).toHaveCount(0);
    const destinations = page.getByRole("button", { name: /^Open (Players|Upgrades|Run|Items)$/ });
    await expect(destinations).toHaveCount(4);
    for (const button of await destinations.all()) await expect(button).toBeDisabled();
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
        "import json,sys; from pathlib import Path; from repo_save_editor.core.crypto import encrypt_save; data=json.loads(Path(sys.argv[1]).read_text()); data['dictionaryOfDictionaries']['value']['runStats']['currency']=37; Path(sys.argv[2]).write_bytes(encrypt_save(data))",
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
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.locator(metrics)).toContainText("37");
    await page.getByRole("button", { name: "Change save" }).click();
    await expect(page.getByRole("button", { name: /Open workspace/ })).toBeVisible();
    await rename(savePath, `${savePath}.hidden`);
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
