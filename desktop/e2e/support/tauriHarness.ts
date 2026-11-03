/** Shared isolated packaged native harness; fixture sidecars never ship. */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  getPythonExecutable,
  isolatedApplicationEnvironment,
} from "./fixtureEnvironment";

export async function native<T>(
  page: Page,
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
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

export async function stageSyntheticBackend(home: string) {
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
  const upgrades = [
    {
      key: "playerUpgradeStrength",
      label: "Strength",
      presentationSource: "humanized",
      gameplayCap: null,
      iconKey: null,
      values: [
        { playerId: "111", value: 2 },
        { playerId: "222", value: 0 },
      ],
    },
  ];
  await writeFile(path.join(home, "upgrades-list.json"), JSON.stringify({ ok: true, upgrades }));
  await writeFile(
    path.join(home, "players-list.json"),
    JSON.stringify({
      ok: true,
      players: [
        { id: "111", name: "Alpha", health: 80, maxHealth: 100 },
        { id: "222", name: "Beta", health: 0, maxHealth: 100 },
      ],
    }),
  );
  await writeFile(
    path.join(home, "game-status.json"),
    JSON.stringify({ ok: true, status: "not_running", running: false }),
  );
  return {
    executable,
    opened,
    upgrades,
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

export async function launch(
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

export async function close(child: ChildProcess, browser: Browser) {
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

export async function stopSyntheticGame(child: ChildProcess | undefined) {
  if (child?.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "close", { signal: AbortSignal.timeout(5000) });
  if (!child.kill()) throw new Error("Synthetic game could not be stopped");
  await exited;
}
