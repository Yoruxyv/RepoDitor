import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import type { DesktopOperationResult, InstalledMapsDto } from "../../electron/contracts.cjs";
import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  createRunSaveFixture,
  isolatedApplicationEnvironment,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import { close, launch, native, stageSyntheticBackend } from "../support/tauriHarness";
import { waitForWorkspaceOrContinue } from "../support/waits";

async function openMaps(page: Page, reference = false) {
  await page.getByRole("button", { name: /Open workspace/ }).click();
  if (reference) await waitForWorkspaceOrContinue(page);
  const tab = page.getByRole("tab", { name: "Maps", exact: true });
  await tab.waitFor({ state: "visible" });
  const started = performance.now();
  await tab.click();
  return started;
}

function catalog(families: string[]) {
  return JSON.stringify({
    m_KeyDataString: Buffer.from(
      families.map((name) => `Level/${name}/Loading Graphics/a`).join(" ") ||
        "Level/Shop/Loading Graphics/a",
    ).toString("base64"),
  });
}

async function reaped(home: string) {
  const ids = JSON.parse(await readFile(path.join(home, "maps-list.json"), "utf8")) as number[];
  expect(ids).toHaveLength(2);
  await expect
    .poll(() =>
      ids.every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
          throw error;
        }
      }),
    )
    .toBe(true);
}

test("packaged Maps match Electron data, fallback cards, refresh and three layouts without changing sources", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("comparison");
  await mkdir(home, { recursive: true });
  const save = await createRunSaveFixture(home);
  const game = await createGameFixture(home);
  const source = path.join(game, "REPO_Data/StreamingAssets/aa/catalog.json");
  const original = await readFile(save);
  const sourceBefore = await readFile(source);
  const environment = isolatedApplicationEnvironment(home, path.join(home, "AppData/LocalLow"));
  environment["REPODITOR_E2E_STEAM_ROOT"] = path.join(home, "SteamLibrary");
  const reference = await electron.launch({
    executablePath: path.join(DESKTOP_ROOT, "release/win-unpacked/RepoDitor.exe"),
    args: ["--disable-gpu", `--user-data-dir=${path.join(home, "electron-profile")}`],
    env: environment,
  });
  let preview: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    preview = await launch(
      path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!),
      home,
    );
    const page = preview.page;
    const referencePage = await reference.firstWindow();
    const timing: Record<string, number> = {};
    for (const [name, target] of [
      ["electron", referencePage],
      ["tauri", page],
    ] as const) {
      const opened = performance.now();
      const tab = await openMaps(target, name === "electron");
      await expect(target.getByRole("heading", { name: "Modded Moon", exact: true })).toBeVisible();
      const ready = performance.now();
      timing[`${name}OpenToMapsMs`] = ready - opened;
      timing[`${name}MapsTabToDataMs`] = ready - tab;
    }
    async function compare() {
      const actual = await native<DesktopOperationResult<InstalledMapsDto>>(page, "maps_list", {
        gameDir: "Z:/untrusted",
        catalogPath: "https://untrusted",
      });
      const expected = await referencePage.evaluate(() => window.repoditor.maps.list());
      expect(actual).toMatchObject({ ok: true });
      expect(expected).toMatchObject({ ok: true });
      if (!actual.ok || !expected.ok) throw new Error("Synthetic Maps could not be read");
      expect(actual.data).toEqual({
        ...expected.data,
        catalogPath: null,
        maps: expected.data.maps.map((map) => ({ ...map, iconToken: null })),
      });
      return actual.data;
    }
    expect((await compare()).maps.map((map) => map.internalName)).toEqual([
      "Manor",
      "Arctic",
      "Modded Moon",
    ]);
    for (const target of [page, referencePage]) {
      await expect(target.getByTestId("map-artwork-Modded Moon")).toHaveAttribute(
        "data-icon-source",
        "fallback",
      );
      await expect(target.locator('[data-testid^="map-artwork-"] img')).toHaveCount(0);
      await expect(target.getByRole("button", { name: /Force map|Select map/ })).toHaveCount(0);
    }
    const runTab = page.getByRole("tab", { name: "Run", exact: true });
    await runTab.click();
    await expect(runTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Maps", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeFocused();
    for (const size of [
      { width: 1600, height: 900 },
      { width: 1200, height: 800 },
      { width: 960, height: 640 },
    ]) {
      for (const [name, target] of [
        ["electron", referencePage],
        ["tauri", page],
      ] as const) {
        await target.setViewportSize(size);
        expect(
          await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const card = await target.getByTestId("map-artwork-Arctic").boundingBox();
        expect(card!.width).toBeGreaterThan(200);
        expect(card!.width / card!.height).toBeCloseTo(2, 1);
        await target.screenshot({
          path: info.outputPath(`${name}-maps-${size.width}.png`),
          fullPage: true,
        });
      }
    }
    expect(await readFile(source)).toEqual(sourceBefore);
    await writeFile(source, catalog(["Arctic", "Future Facility"]));
    const changed = await readFile(source);
    for (const target of [page, referencePage]) {
      const started = performance.now();
      await target.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        target.getByRole("heading", { name: "Future Facility", exact: true }),
      ).toBeVisible();
      timing[target === page ? "tauriRefreshMs" : "electronRefreshMs"] =
        performance.now() - started;
      await expect(target.getByRole("heading", { name: "Modded Moon", exact: true })).toHaveCount(
        0,
      );
    }
    await compare();
    expect(await readFile(source)).toEqual(changed);
    for (let i = 0; i < 3; i++) {
      await page.getByRole("tab", { name: "Run", exact: true }).click();
      await page.getByRole("tab", { name: "Maps", exact: true }).click();
      await expect(page.getByTestId("maps-skeleton")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Future Facility", exact: true }),
      ).toBeVisible();
    }
    await writeFile(source, catalog([]));
    for (const target of [page, referencePage]) {
      await target.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(target.locator('[data-testid^="map-artwork-"]')).toHaveCount(0);
      await expect(target.getByText("No maps were found in the installed catalog.")).toBeVisible();
      await expect(target.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    }
    const empty = await compare();
    expect(empty.available).toBe(true);
    expect(empty.maps).toEqual([]);
    await rename(game, `${game}.hidden`);
    for (const target of [page, referencePage]) {
      await target.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        target.getByText(/No validated R\.E\.P\.O\. installation was found/),
      ).toBeVisible();
      await expect(target.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
      await expect(target.getByRole("heading", { name: "Maps", exact: true })).toBeVisible();
    }
    expect(await compare()).toEqual({ available: false, catalogPath: null, maps: [] });
    expect(await readFile(save)).toEqual(original);
    await writeFile(
      info.outputPath("maps-timing.json"),
      JSON.stringify(
        {
          ...timing,
          note: "Synthetic catalog and encrypted save; includes host startup/queue costs, not production performance.",
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      if (preview) await close(preview.child, preview.browser);
    } finally {
      await reference.close();
    }
  }
});

test("native Maps reject malformed metadata, preserve refresh data, fail closed and recover", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("failures");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "maps-list.json");
  const healthy = await readFile(response, "utf8");
  await writeFile(response, "exit7");
  const { child, browser, page } = await launch(fixture.executable, home, fixture.environment);
  try {
    await openMaps(page);
    await expect(page.getByRole("alert")).toBeVisible();
    const map = fixture.maps.maps[0];
    for (const [payload, code] of [
      ["{", "malformed_response"],
      [" ", "empty_response"],
      ["exit7", "process_failed"],
      ...[
        { ok: true },
        { ok: 1 },
        { ok: true, ...fixture.maps, available: 1 },
        { ok: true, ...fixture.maps, catalogPath: null },
        { ok: true, ...fixture.maps, available: false, catalogPath: null },
        { ok: true, ...fixture.maps, maps: [map, map] },
        {
          ok: true,
          ...fixture.maps,
          maps: Array.from({ length: 129 }, (_, i) => ({ ...map, internalName: `Map${i}` })),
        },
        ...[
          { internalName: "../secret" },
          { displayName: "bad\nname" },
          { knownLabel: "yes" },
          { artworkRevision: "A".repeat(64) },
        ].map((fields) => ({ ok: true, ...fixture.maps, maps: [{ ...map, ...fields }] })),
      ].map((value) => [JSON.stringify(value), "invalid_response"]),
      [
        JSON.stringify({
          ok: false,
          error: { code: "backend_unavailable", message: "private path" },
        }),
        "backend_unavailable",
      ],
    ]) {
      await writeFile(response, payload);
      expect(await native(page, "maps_list")).toMatchObject({ ok: false, error: { code } });
    }
    await writeFile(response, healthy);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Modded Moon", exact: true })).toBeVisible();
    await writeFile(response, "exit7");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Modded Moon", exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("private");
    await writeFile(response, healthy);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    for (const status of [
      { status: "running", running: true },
      { status: "unknown", running: false },
    ]) {
      await writeFile(path.join(home, "game-status.json"), JSON.stringify({ ok: true, ...status }));
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
    for (const command of [
      "maps_write",
      "maps_artwork",
      "cosmetics_write",
      "saves_write",
      "plugin:fs|read_file",
      "plugin:shell|execute",
    ]) {
      await expect(native(page, command, { path: "Z:/private" })).rejects.toBeDefined();
    }
  } finally {
    await close(child, browser);
  }
});

test("slow Maps retain cards while status runs independently and domain reads queue", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("scheduling");
  const fixture = await stageSyntheticBackend(home);
  const marker = path.join(home, "started.txt");
  const recordsDir = path.join(home, "records");
  await mkdir(recordsDir);
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_DELAY_MS: "2000",
    REPODITOR_TEST_DELAY_COMMAND: "maps-list",
    REPODITOR_TEST_STARTED_FILE: marker,
    REPODITOR_TEST_TIMING_DIR: recordsDir,
  });
  try {
    await openMaps(page);
    await expect(page.getByRole("heading", { name: "Modded Moon", exact: true })).toBeVisible();
    // Visit Run before reserving its only read slot with the deliberate queued request.
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    await writeFile(marker, "");
    const requested = Date.now();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => readFile(marker, "utf8")).toBe("maps-list");
    await expect(page.getByRole("button", { name: "Refreshing", exact: true })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Modded Moon", exact: true })).toBeVisible();
    await expect(page.getByTestId("maps-skeleton")).toHaveCount(0);
    expect(await native(page, "maps_list")).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    const queuedAt = Date.now();
    const queued = native(page, "run_get", { saveId: E2E_SAVE_ID });
    const uiStarted = performance.now();
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    const uiElapsedMs = performance.now() - uiStarted;
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "unknown", running: false }),
    );
    const focus = performance.now();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("dialog")).toBeVisible();
    const focusToSafetyDialogMs = performance.now() - focus;
    await expect(
      page.getByRole("button", { name: "Refreshing", exact: true, includeHidden: true }),
    ).toBeDisabled();
    expect(await queued).toMatchObject({ ok: true });
    const records = [];
    for (const file of await readdir(recordsDir)) {
      const record = JSON.parse(await readFile(path.join(recordsDir, file), "utf8")) as {
        operation: string;
        started: number;
        finished: number;
      };
      if (record.started >= requested) records.push(record);
    }
    const maps = records.find((record) => record.operation === "maps-list")!;
    const game = records.find((record) => record.operation === "game-status")!;
    const run = records.find((record) => record.operation === "run-get")!;
    expect(maps.finished - maps.started).toBeGreaterThanOrEqual(2000);
    expect(game.started).toBeLessThan(maps.finished);
    expect(game.finished).toBeLessThan(maps.finished);
    expect(run.started).toBeGreaterThanOrEqual(maps.finished);
    await writeFile(
      info.outputPath("maps-scheduling.json"),
      JSON.stringify(
        {
          uiElapsedMs,
          focusToSafetyDialogMs,
          domainPreExecutionMs: run.started - queuedAt,
          records,
          note: "Synthetic 2s Maps read. Pre-execution includes IPC, scheduling and process startup; not a production benchmark.",
        },
        null,
        2,
      ),
    );
  } finally {
    await close(child, browser);
  }
});

test("Maps keep the 30s deadline, reap child trees and recover; close cancels a pending read", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("lifecycle");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "maps-list.json");
  const healthy = await readFile(response, "utf8");
  const pidDir = path.join(home, "pids");
  await mkdir(pidDir);
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_PID_DIR: pidDir,
  });
  let closed = false;
  try {
    await openMaps(page);
    await expect(page.getByRole("heading", { name: "Modded Moon", exact: true })).toBeVisible();
    await writeFile(response, "hang");
    const started = performance.now();
    const read = native(page, "maps_list");
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(path.join(pidDir, "maps-list.json"), "utf8"));
        } catch {
          return [];
        }
      })
      .toHaveLength(2);
    expect(await native(page, "maps_list")).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    expect(await read).toMatchObject({ ok: false, error: { code: "process_timeout" } });
    const timeoutMs = performance.now() - started;
    expect(timeoutMs).toBeGreaterThanOrEqual(29_000);
    await reaped(pidDir);
    await writeFile(response, healthy);
    expect(await native(page, "maps_list")).toMatchObject({ ok: true });
    const backend = path.join(home, "backend/repoditor-backend.exe");
    await rename(backend, `${backend}.hidden`);
    expect(await native(page, "maps_list")).toMatchObject({
      ok: false,
      error: { code: "python_unavailable" },
    });
    await rename(`${backend}.hidden`, backend);
    expect(await native(page, "maps_list")).toMatchObject({ ok: true });
    await writeFile(response, "hang");
    await rename(path.join(pidDir, "maps-list.json"), path.join(pidDir, "timed-out.json"));
    const pending = native(page, "maps_list").catch(() => null);
    await expect
      .poll(async () => {
        try {
          return JSON.parse(await readFile(path.join(pidDir, "maps-list.json"), "utf8"));
        } catch {
          return [];
        }
      })
      .toHaveLength(2);
    await close(child, browser);
    closed = true;
    await pending;
    await reaped(pidDir);
    await writeFile(
      info.outputPath("maps-lifecycle.json"),
      JSON.stringify(
        { timeoutMs, childTreesReaped: true, recovery: true, closeCancelled: true },
        null,
        2,
      ),
    );
  } finally {
    if (!closed) await close(child, browser);
  }
});
