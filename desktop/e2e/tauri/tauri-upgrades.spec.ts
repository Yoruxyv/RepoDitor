import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test, type Page, type TestInfo } from "@playwright/test";
import type { DesktopOperationResult, PlayerUpgradeDto } from "../../electron/contracts.cjs";
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

function rewriteSave(savePath: string, mode: "dynamic" | "changed" | "empty") {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      [
        "import json,sys",
        "from pathlib import Path",
        "from repo_save_editor.core.crypto import encrypt_save",
        "data=json.loads(Path(sys.argv[1]).read_text())",
        "values=data['dictionaryOfDictionaries']['value']",
        "values.update({'playerUpgradeMoonBoots':{'222':7},'playerUpgradeFutureBoost':{'111':2147483648},'playerUpgradeLaunch':{'111':2,'222':5}})",
        "if sys.argv[3]=='changed': values['playerUpgradeFutureBoost']['111']=37; data['playerNames']['value']={'111':'Alpha'}",
        "if sys.argv[3]=='empty': data['dictionaryOfDictionaries']['value']={key:value for key,value in values.items() if not key.startswith('playerUpgrade')}",
        "Path(sys.argv[2]).write_bytes(encrypt_save(data))",
      ].join("\n"),
      path.join(DESKTOP_ROOT, "e2e/fixtures/save.json"),
      savePath,
      mode,
    ],
    {
      cwd: PYTHON_ROOT,
      env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
      windowsHide: true,
    },
  );
}

async function openUpgrades(page: Page, reference = false) {
  await page.getByRole("button", { name: /Open workspace/ }).click();
  if (reference) await waitForWorkspaceOrContinue(page);
  await page.getByRole("tab", { name: "Upgrades" }).click();
}

async function compareValues(page: Page, reference: Page, name: string) {
  const result = await native<DesktopOperationResult<PlayerUpgradeDto[]>>(page, "upgrades_list", {
    saveId: E2E_SAVE_ID,
  });
  const expected = await reference.evaluate(
    (id) => window.repoditor.upgrades.list(id),
    E2E_SAVE_ID,
  );
  expect(result.ok).toBe(true);
  expect(expected.ok).toBe(true);
  if (!result.ok || !expected.ok) throw new Error("Synthetic upgrades could not be read");
  expect(result.data.map((item) => ({ ...item, iconToken: null }))).toEqual(
    expected.data.map((item) => ({ ...item, iconToken: null })),
  );
  for (const item of result.data) {
    if (item.iconToken !== null) expect(item.iconToken).toMatch(/^upgrade-artwork:[0-9a-f]{32}$/);
  }
  for (const upgrade of result.data) {
    const label = `${upgrade.label} for ${name}`;
    await expect(page.getByRole("textbox", { name: label })).toHaveValue(
      await reference.getByRole("spinbutton", { name: label }).inputValue(),
    );
    await expect(page.getByTestId(`upgrade-icon-${upgrade.key}`)).not.toHaveAttribute(
      "data-icon-source",
      "local",
    );
  }
  return result.data;
}

async function compareLayouts(page: Page, reference: Page, info: TestInfo) {
  for (const size of [
    { width: 1600, height: 900 },
    { width: 1200, height: 800 },
    { width: 960, height: 640 },
  ]) {
    for (const target of [page, reference]) {
      await target.setViewportSize(size);
      expect(
        await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`native-upgrades-${size.width}.png`) });
    await reference.screenshot({ path: info.outputPath(`electron-upgrades-${size.width}.png`) });
  }
}

test("packaged Upgrades retain dynamic values, shared selection and read-only parity", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("comparison");
  await mkdir(home, { recursive: true });
  const savePath = await createRunSaveFixture(home);
  rewriteSave(savePath, "dynamic");
  const original = await readFile(savePath);
  const gameRoot = await createGameFixture(home);
  const environment = isolatedApplicationEnvironment(home, path.join(home, "AppData/LocalLow"));
  environment["REPODITOR_E2E_STEAM_ROOT"] = path.join(home, "SteamLibrary");
  const reference = await electron.launch({
    executablePath: path.join(DESKTOP_ROOT, "release/win-unpacked/RepoDitor.exe"),
    args: ["--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
    env: environment,
  });
  let preview: Awaited<ReturnType<typeof launch>> | undefined;
  let game: ChildProcess | undefined;
  try {
    preview = await launch(
      path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!),
      home,
    );
    const page = preview.page;
    const referencePage = await reference.firstWindow();
    await openUpgrades(referencePage, true);
    const clicked = performance.now();
    await openUpgrades(page);
    await expect(page.getByRole("textbox", { name: "Future Boost for Alpha" })).toHaveValue(
      "2147483648",
    );
    await writeFile(
      info.outputPath("upgrades-open-timing.json"),
      JSON.stringify({ openToUpgradeValueMs: performance.now() - clicked }),
    );
    const catalog = await compareValues(page, referencePage, "Alpha");
    expect(catalog.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        "playerUpgradeStrength",
        "playerUpgradeMoonBoots",
        "playerUpgradeFutureBoost",
        "playerUpgradeLaunch",
      ]),
    );
    const output = page.getByRole("textbox", { name: "Future Boost for Alpha" });
    await output.focus();
    await page.keyboard.press("ArrowUp");
    await expect(output).toHaveValue("2147483648");
    await expect(output).toBeFocused();
    await expect(output).toHaveAttribute("readonly", "");
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Revert|Save Changes/ })).toHaveCount(0);
    await expect(page.locator('[data-testid^="pending-upgrade-"]')).toHaveCount(0);
    await expect(page.locator('img[src^="repoditor-icon:"]')).toHaveCount(0);
    for (const target of [page, referencePage]) {
      await target.getByRole("combobox", { name: "Player" }).click();
      await target.getByRole("option", { name: "Beta", exact: true }).click();
    }
    await compareValues(page, referencePage, "Beta");
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("button", { name: /Beta/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("tab", { name: "Players" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Upgrades" })).toBeFocused();
    await expect(page.getByTestId("selected-player-identity")).toContainText("Beta");
    await compareLayouts(page, referencePage, info);
    expect(await readFile(savePath)).toEqual(original);
    game = spawn(path.join(gameRoot, "REPO.exe"), ["-e", "setInterval(() => {}, 1000)"], {
      cwd: gameRoot,
      stdio: "ignore",
      windowsHide: true,
    });
    await once(game, "spawn", { signal: AbortSignal.timeout(5000) });
    await expect
      .poll(async () => native(page, "game_status"))
      .toEqual({ ok: true, data: { status: "running", running: true } });
    for (const target of [page, referencePage]) {
      await target.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        target.getByRole("heading", { name: "R.E.P.O. is currently running" }),
      ).toBeVisible();
    }
    await stopSyntheticGame(game);
    for (const target of [page, referencePage]) {
      await target.getByRole("button", { name: "Check Again" }).click();
      await expect(target.getByRole("dialog")).toHaveCount(0);
    }
    rewriteSave(savePath, "changed");
    const changed = await readFile(savePath);
    const read = await native<DesktopOperationResult<PlayerUpgradeDto[]>>(page, "upgrades_list", {
      saveId: E2E_SAVE_ID,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("Changed synthetic upgrades could not be read");
    expect(read.data.find((item) => item.key === "playerUpgradeFutureBoost")?.values).toEqual([
      { playerId: "111", value: 37 },
    ]);
    for (const target of [page, referencePage]) {
      await target.getByRole("button", { name: "Change save" }).click();
      await openUpgrades(target, target === referencePage);
    }
    await expect(page.getByRole("textbox", { name: "Future Boost for Alpha" })).toHaveValue("37");
    await compareValues(page, referencePage, "Alpha");
    expect(await readFile(savePath)).toEqual(changed);
    await rename(savePath, `${savePath}.hidden`);
    expect(await native(page, "upgrades_list", { saveId: E2E_SAVE_ID })).toEqual(
      await referencePage.evaluate((id) => window.repoditor.upgrades.list(id), E2E_SAVE_ID),
    );
    await rename(`${savePath}.hidden`, savePath);
    await writeFile(savePath, "bad");
    const corrupt = await native(page, "upgrades_list", { saveId: E2E_SAVE_ID });
    expect(corrupt).toMatchObject({ ok: false, error: { code: "save_corrupt" } });
    expect(corrupt).toEqual(
      await referencePage.evaluate((id) => window.repoditor.upgrades.list(id), E2E_SAVE_ID),
    );
    expect(await readFile(savePath, "utf8")).toBe("bad");
    rewriteSave(savePath, "empty");
    const empty = await readFile(savePath);
    for (const target of [page, referencePage]) {
      await target.getByRole("button", { name: "Change save" }).click();
      await openUpgrades(target, target === referencePage);
      await expect(target.getByText("This save contains no player upgrades.")).toBeVisible();
    }
    expect(await native(page, "upgrades_list", { saveId: E2E_SAVE_ID })).toEqual({
      ok: true,
      data: [],
    });
    expect(await readFile(savePath)).toEqual(empty);
  } finally {
    try {
      await stopSyntheticGame(game);
    } finally {
      try {
        if (preview) await close(preview.child, preview.browser);
      } finally {
        await reference.close();
      }
    }
  }
});

test("native Upgrades reject malformed DTOs and recover with fallback and game safety", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("failures");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "upgrades-list.json");
  const healthy = await readFile(response, "utf8");
  await writeFile(response, "exit7");
  const { child, browser, page } = await launch(fixture.executable, home, fixture.environment);
  try {
    await openUpgrades(page);
    await expect(page.getByRole("alert")).toBeVisible();
    for (const saveId of [null, 42, "../save.es3", "--help"])
      expect(await native(page, "upgrades_list", { saveId })).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    expect(await native(page, "upgrades_list")).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    const dto = fixture.upgrades[0];
    for (const [payload, code] of [
      ["{", "malformed_response"],
      [JSON.stringify({ ok: true }), "invalid_response"],
      [JSON.stringify({ ok: true, upgrades: [{ ...dto, key: "unknown" }] }), "invalid_response"],
      [JSON.stringify({ ok: true, upgrades: [dto, dto] }), "invalid_response"],
      [
        JSON.stringify({
          ok: true,
          upgrades: [
            {
              ...dto,
              values: [
                { playerId: "111", value: 2 },
                { playerId: "111", value: 3 },
              ],
            },
          ],
        }),
        "invalid_response",
      ],
      [
        JSON.stringify({ ok: true, upgrades: [{ ...dto, iconKey: "../private.png" }] }),
        "invalid_response",
      ],
      [
        JSON.stringify({ ok: false, error: { code: "save_missing", message: "private path" } }),
        "save_missing",
      ],
    ] as const) {
      await writeFile(response, payload);
      expect(await native(page, "upgrades_list", { saveId: E2E_SAVE_ID })).toMatchObject({
        ok: false,
        error: { code },
      });
      await page.getByRole("button", { name: "Change save" }).click();
      await openUpgrades(page);
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("private");
    }
    await writeFile(response, healthy);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("textbox", { name: "Strength for Alpha" })).toHaveValue("2");
    await expect(page.getByTestId("upgrade-icon-playerUpgradeStrength")).not.toHaveAttribute(
      "data-icon-source",
      "local",
    );
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
    }
    await writeFile(
      path.join(home, "players-list.json"),
      JSON.stringify({ ok: true, players: [] }),
    );
    await page.getByRole("button", { name: "Change save" }).click();
    await openUpgrades(page);
    await expect(page.getByText("This save does not contain player records.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /for Alpha/ })).toHaveCount(0);
  } finally {
    await close(child, browser);
  }
});

test("five frozen reads and a controlled sidecar distinguish execution from pre-execution wait", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("timing");
  await mkdir(home, { recursive: true });
  await createRunSaveFixture(home);
  await createGameFixture(home);
  const environment = isolatedApplicationEnvironment(home, path.join(home, "AppData/LocalLow"));
  environment["REPODITOR_E2E_STEAM_ROOT"] = path.join(home, "SteamLibrary");
  const reference = await electron.launch({
    executablePath: path.join(DESKTOP_ROOT, "release/win-unpacked/RepoDitor.exe"),
    args: ["--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
    env: environment,
  });
  let preview: Awaited<ReturnType<typeof launch>> | undefined;
  const samples: unknown[] = [];
  const cli = promisify(execFile);
  try {
    preview = await launch(
      path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!),
      home,
    );
    const page = preview.page;
    const electronPage = await reference.firstWindow();
    await openUpgrades(electronPage, true);
    await openUpgrades(page);
    await expect(page.getByRole("textbox", { name: "Strength for Alpha" })).toHaveValue("2");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("textbox", { name: "Currency" })).toHaveValue("12");
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByRole("searchbox", { name: "Search items" })).toBeVisible();
    for (let trial = 0; trial < 3; trial++) {
      const nativeStart = performance.now();
      const nativeTimes = await Promise.all(
        ["players_list", "upgrades_list", "run_get", "advanced_get", "game_status"].map(
          async (command) => {
            const started = performance.now();
            expect(await native(page, command, { saveId: E2E_SAVE_ID })).toMatchObject({
              ok: true,
            });
            return { command, elapsedMs: performance.now() - started };
          },
        ),
      );
      const nativeTotalMs = performance.now() - nativeStart;
      const electronStart = performance.now();
      const referenceTimes = await electronPage.evaluate(
        async (id) =>
          Promise.all(
            [
              ["players_list", () => window.repoditor.players.list(id)],
              ["upgrades_list", () => window.repoditor.upgrades.list(id)],
              ["run_get", () => window.repoditor.run.get(id)],
              ["advanced_get", () => window.repoditor.advanced.get(id)],
              ["game_status", () => window.repoditor.game.status()],
            ].map(async ([command, invoke]) => {
              const started = performance.now();
              const result = await (invoke as () => Promise<unknown>)();
              return { command, elapsedMs: performance.now() - started, result };
            }),
          ),
        E2E_SAVE_ID,
      );
      const electronTotalMs = performance.now() - electronStart;
      for (const result of referenceTimes) expect(result.result).toMatchObject({ ok: true });
      const standalone = [];
      for (const command of [
        "players-list",
        "upgrades-list",
        "run-get",
        "advanced-get",
        "game-status",
      ]) {
        const backend = path.join(
          DESKTOP_ROOT,
          "build/tauri-preview/backend/repoditor-backend.exe",
        );
        const started = performance.now();
        const result = await cli(
          backend,
          command === "game-status" ? [command] : [command, E2E_SAVE_ID],
          {
            cwd: path.dirname(backend),
            env: environment,
            windowsHide: true,
            timeout: 30000,
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
        standalone.push({ command, elapsedMs: performance.now() - started });
      }
      samples.push({
        trial,
        nativeTotalMs,
        nativeTimes,
        electronTotalMs,
        referenceTimes,
        standalone,
      });
    }
  } finally {
    try {
      if (preview) await close(preview.child, preview.browser);
    } finally {
      await reference.close();
    }
  }
  const synthetic = info.outputPath("controlled");
  const fixture = await stageSyntheticBackend(synthetic);
  const timingDir = path.join(synthetic, "records");
  await mkdir(timingDir);
  const { child, browser, page } = await launch(fixture.executable, synthetic, {
    ...fixture.environment,
    REPODITOR_TEST_DELAY_MS: "200",
    REPODITOR_TEST_TIMING_DIR: timingDir,
  });
  try {
    await openUpgrades(page);
    await expect(page.getByRole("textbox", { name: "Strength for Alpha" })).toHaveValue("2");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("textbox", { name: "Currency" })).toHaveValue("12");
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByRole("searchbox", { name: "Search items" })).toBeVisible();
    const requested = Date.now();
    await Promise.all(
      ["players_list", "upgrades_list", "run_get", "advanced_get", "game_status"].map(
        async (command) =>
          expect(await native(page, command, { saveId: E2E_SAVE_ID })).toMatchObject({ ok: true }),
      ),
    );
    const records = [];
    for (const name of await readdir(timingDir)) {
      const item = JSON.parse(await readFile(path.join(timingDir, name), "utf8")) as {
        operation: string;
        started: number;
        finished: number;
      };
      if (item.started >= requested)
        records.push({
          ...item,
          preExecutionMs: item.started - requested,
          backendMs: item.finished - item.started,
        });
    }
    records.sort((a, b) => a.started - b.started);
    expect(records).toHaveLength(5);
    for (const item of records) expect(item.backendMs).toBeGreaterThanOrEqual(200);
    const domains = records.filter((record) => record.operation !== "game-status");
    const game = records.find((record) => record.operation === "game-status")!;
    expect(domains).toHaveLength(4);
    for (let index = 1; index < domains.length; index++)
      expect(domains[index].started).toBeGreaterThanOrEqual(domains[index - 1].finished);
    expect(domains[3].preExecutionMs - domains[0].preExecutionMs).toBeGreaterThanOrEqual(600);
    expect(
      domains.some((record) => game.started < record.finished && game.finished > record.started),
    ).toBe(true);
    await writeFile(
      info.outputPath("items-concurrency.json"),
      JSON.stringify(
        {
          samples,
          controlledRecords: records,
          note: "Pre-execution includes IPC and process startup as well as queue wait; standalone CLI includes process startup. Controlled backend duration is measured inside the synthetic helper. Status is independent; domain reads remain serialized. No production timing API.",
        },
        null,
        2,
      ),
    );
  } finally {
    await close(child, browser);
  }
});
