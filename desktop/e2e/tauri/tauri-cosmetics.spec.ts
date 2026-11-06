import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import type { CosmeticsViewDto, DesktopOperationResult } from "../../electron/contracts.cjs";
import {
  DESKTOP_ROOT,
  PYTHON_ROOT,
  createMetaSaveFixture,
  getPythonExecutable,
  isolatedApplicationEnvironment,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import { close, launch, native, stageSyntheticBackend } from "../support/tauriHarness";

async function openCosmetics(page: Page) {
  const started = performance.now();
  await page.getByRole("button", { name: "Cosmetics", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search cosmetics" })).toBeVisible();
  return performance.now() - started;
}

async function metaFixture(home: string) {
  await mkdir(path.join(home, "AppData/LocalLow/semiwork/Repo"), { recursive: true });
  return createMetaSaveFixture(home);
}

function rewriteMeta(meta: string, mode: "changed" | "unsupported") {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      [
        "import json,sys",
        "from pathlib import Path",
        "from repo_save_editor.core.crypto import encrypt_save",
        "data=json.loads(Path(sys.argv[1]).read_text())",
        "data['cosmeticHistory']['value']=[0,28,999]",
        "data['cosmeticUnlocks']['value']=[0,28,999]",
        "if sys.argv[3]=='unsupported': data['cosmeticHistory']['value']='bad'",
        "Path(sys.argv[2]).write_bytes(encrypt_save(data))",
      ].join("\n"),
      path.join(DESKTOP_ROOT, "e2e/fixtures/meta-save.json"),
      meta,
      mode,
    ],
    { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT }, windowsHide: true },
  );
}

async function select(page: Page, label: string, value: string) {
  const control = page.getByRole("combobox", { name: label, exact: true });
  await control.focus();
  await page.keyboard.press("Enter");
  await page.locator(`[role="option"][data-value="${value}"]`).click();
  await expect(control).toBeFocused();
}

async function visibleIds(page: Page) {
  return page
    .locator("[data-cosmetic-id]:visible")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-cosmetic-id")));
}

async function compare(page: Page, reference: Page) {
  const actual = await native<DesktopOperationResult<CosmeticsViewDto>>(page, "cosmetics_get", {
    saveId: "../untrusted",
    metaPath: "Z:/private",
    url: "https://untrusted",
  });
  const expected = await reference.evaluate(() => window.repoditor.cosmetics.get());
  expect(actual).toMatchObject({ ok: true });
  expect(expected).toMatchObject({ ok: true });
  if (!actual.ok || !expected.ok) throw new Error("Synthetic Cosmetics could not be read");
  expect(actual.data).toEqual({
    ...expected.data,
    cosmetics: expected.data.cosmetics.map((entry) => ({ ...entry, iconToken: null })),
  });
  expect(JSON.stringify(actual)).not.toMatch(/cosmeticTokens|rawMetaSave|iconKey|backupPath/);
  return actual.data;
}

async function processIds(root: string, count = 2) {
  let ids: number[] = [];
  await expect
    .poll(async () => {
      try {
        ids = JSON.parse(await readFile(path.join(root, "cosmetics-get.json"), "utf8")) as number[];
        return ids.length;
      } catch {
        return 0;
      }
    })
    .toBe(count);
  return ids;
}
async function reaped(ids: number[]) {
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

test("packaged global Cosmetics retain Electron data, catalog interactions and three layouts without mutations", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("comparison");
  const meta = await metaFixture(home);
  const game = await createGameFixture(home);
  const original = await readFile(meta);
  const level = path.join(game, "REPO_Data/level0");
  const levelBefore = await readFile(level);
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
    timing["electronEntryMs"] = await openCosmetics(referencePage);
    timing["tauriEntryMs"] = await openCosmetics(page);
    const initial = await compare(page, referencePage);
    expect(initial.knownCatalogCount).toBe(28);
    expect(initial.knownOwnedCount).toBe(1);
    expect(initial.unknownOwnedIds).toEqual([999]);
    expect(initial.capabilities.canUnlockCosmetic).toBe(true);
    expect(initial.cosmetics.find((entry) => entry.id === 27)).toMatchObject({
      owned: true,
      known: true,
      state: "owned",
    });
    await expect(page.getByTestId("workspace")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Unlock|Lock All|Clear All Presets|Revert|Save Changes/ }),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid^="cosmetics-pending"]')).toHaveCount(0);
    await expect(page.getByTestId("cosmetic-icon-27")).toHaveAttribute(
      "data-icon-source",
      "fallback",
    );
    await expect(page.locator('img[src^="repoditor-icon:"]')).toHaveCount(0);
    await expect(
      referencePage.getByRole("button", { name: "Unlock All Cosmetics", exact: true }),
    ).toBeVisible();
    for (const target of [page, referencePage]) {
      await target.getByRole("searchbox", { name: "Search cosmetics" }).fill("  999  ");
      await expect(target.locator('[data-cosmetic-id="999"]')).toBeVisible();
      await expect(target.locator('[data-cosmetic-id="27"]')).toBeHidden();
      await target.getByRole("button", { name: "Clear cosmetic search" }).click();
      await expect(target.getByRole("searchbox", { name: "Search cosmetics" })).toBeFocused();
    }
    for (const ownership of ["locked", "owned", "all"]) {
      for (const target of [page, referencePage]) await select(target, "Ownership", ownership);
      expect(await visibleIds(page)).toEqual(await visibleIds(referencePage));
    }
    for (const type of ["0", "3", "all"]) {
      for (const target of [page, referencePage]) await select(target, "Type", type);
      expect(await visibleIds(page)).toEqual(await visibleIds(referencePage));
    }
    for (const sort of [
      "name-desc",
      "rarity-asc",
      "rarity-desc",
      "id-asc",
      "id-desc",
      "name-asc",
    ]) {
      for (const target of [page, referencePage]) await select(target, "Sort", sort);
      expect(await visibleIds(page)).toEqual(await visibleIds(referencePage));
    }
    await page.getByRole("searchbox", { name: "Search cosmetics" }).fill("no such cosmetic");
    await expect(
      page.getByText("No cosmetics match the current search and filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear cosmetic search" }).click();
    for (const size of [
      { width: 1600, height: 900 },
      { width: 1200, height: 800 },
      { width: 960, height: 640 },
    ]) {
      for (const [name, target] of [
        ["tauri", page],
        ["electron", referencePage],
      ] as const) {
        await target.setViewportSize(size);
        expect(
          await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await expect(target.getByRole("searchbox", { name: "Search cosmetics" })).toBeVisible();
        await target.screenshot({
          path: info.outputPath(`${name}-cosmetics-${size.width}.png`),
          fullPage: true,
        });
      }
    }
    expect(await readFile(meta)).toEqual(original);
    expect(await readFile(level)).toEqual(levelBefore);
    rewriteMeta(meta, "changed");
    const changed = await readFile(meta);
    const refresh = performance.now();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Cosmetic #28", { exact: true })).toBeVisible();
    timing["tauriRefreshMs"] = performance.now() - refresh;
    await referencePage.getByRole("button", { name: "Run Saves", exact: true }).click();
    timing["electronReentryMs"] = await openCosmetics(referencePage);
    expect((await compare(page, referencePage)).unknownOwnedIds).toEqual([28, 999]);
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Run Saves", exact: true }).click();
      await openCosmetics(page);
      await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    }
    expect(await readFile(meta)).toEqual(changed);
    expect(await readFile(level)).toEqual(levelBefore);
    await createGameFixture(home, 559);
    const futureSource = await readFile(level);
    const future = await compare(page, referencePage);
    expect(future.knownCatalogCount).toBe(559);
    expect(future.cosmetics.slice(557, 559)).toEqual(
      [557, 558].map((id) =>
        expect.objectContaining({
          id,
          known: true,
          owned: false,
          mutationEligible: false,
          removalBlockedReason: expect.any(String),
        }),
      ),
    );
    expect(await readFile(meta)).toEqual(changed);
    expect(await readFile(level)).toEqual(futureSource);
    await writeFile(
      info.outputPath("cosmetics-timing.json"),
      JSON.stringify(
        {
          ...timing,
          note: "Single synthetic MetaSave/catalog observation; entry paths include different preparation, not a production benchmark.",
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

test("frozen Cosmetics preserve unknown ownership without metadata and distinguish missing, corrupt and unsupported MetaSave", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("real-failures");
  const meta = await metaFixture(home);
  const game = await createGameFixture(home);
  const original = await readFile(meta);
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
    await openCosmetics(referencePage);
    await openCosmetics(page);
    const recovery: { mode: string; retryMs: number }[] = [];
    for (const [mode, code] of [
      ["missing", "meta_missing"],
      ["corrupt", "save_decrypt_failed"],
      ["unsupported", "save_unsupported"],
    ] as const) {
      if (mode === "missing") await rename(meta, `${meta}.hidden`);
      else if (mode === "corrupt") await writeFile(meta, "invalid encrypted fixture");
      else rewriteMeta(meta, "unsupported");
      const bytes = mode === "missing" ? null : await readFile(meta);
      const actual = await native(page, "cosmetics_get");
      const expected = await referencePage.evaluate(() => window.repoditor.cosmetics.get());
      expect(actual).toMatchObject({ ok: false, error: { code } });
      expect(expected).toMatchObject({ ok: false, error: { code } });
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      if (bytes) expect(await readFile(meta)).toEqual(bytes);
      if (mode === "missing") await rename(`${meta}.hidden`, meta);
      await writeFile(meta, original);
      const retry = performance.now();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await expect(page.getByRole("searchbox", { name: "Search cosmetics" })).toBeVisible();
      recovery.push({ mode, retryMs: performance.now() - retry });
    }
    const level = path.join(game, "REPO_Data/level0");
    await rename(level, `${level}.hidden`);
    const degraded = await compare(page, referencePage);
    expect(degraded).toMatchObject({
      catalogAvailable: false,
      knownCatalogCount: 0,
      knownOwnedCount: 0,
      knownLockedCount: 0,
      unknownOwnedIds: [27, 999],
      capabilities: {
        canReadCosmetics: true,
        canUnlockCosmetic: false,
        canUnlockAll: false,
        canRemoveOwnership: false,
      },
    });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Cosmetic #27", { exact: true })).toBeVisible();
    await expect(page.getByText("Cosmetic #999", { exact: true })).toBeVisible();
    expect(await readFile(meta)).toEqual(original);
    await writeFile(
      info.outputPath("cosmetics-recovery-timing.json"),
      JSON.stringify(
        {
          recovery,
          note: "Synthetic restored encrypted MetaSave; one retry observation per failure mode, not production latency.",
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

test("native Cosmetics reject malformed projections, recover without writes and preserve game-safety restrictions", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("validation");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "cosmetics-get.json");
  const healthy = await readFile(response, "utf8");
  await writeFile(response, "exit7");
  const { child, browser, page } = await launch(fixture.executable, home, fixture.environment);
  try {
    await page.getByRole("button", { name: "Cosmetics", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    const projection = fixture.cosmetics;
    const item = projection.cosmetics[0];
    for (const [payload, code] of [
      ["{", "malformed_response"],
      [" ", "empty_response"],
      ["exit7", "process_failed"],
      ...[
        { ok: true },
        { ok: 1 },
        { ok: true, cosmetics: { ...projection, fingerprint: "A".repeat(64) } },
        ...[
          { knownOwnedCount: 0 },
          { knownLockedCount: 0 },
          { catalogAvailable: false },
          { savedPresetCount: -1 },
          { unknownOwnedIds: [999, 999] },
          { capabilities: { ...projection.capabilities, canUnlockAll: false } },
        ].map((fields) => ({ ok: true, cosmetics: { ...projection, ...fields } })),
        ...[
          { id: 0.5 },
          { type: null },
          { rarity: true },
          { status: 9007199254740992 },
          { mutationEligible: false },
          { state: "unknown" },
          { iconKey: "../private.png" },
          { removalBlockedReason: " " },
        ].map((fields) => ({
          ok: true,
          cosmetics: {
            ...projection,
            cosmetics: [{ ...item, ...fields }, ...projection.cosmetics.slice(1)],
          },
        })),
        {
          ok: true,
          cosmetics: { ...projection, cosmetics: [item, item, ...projection.cosmetics.slice(2)] },
        },
      ].map((value) => [JSON.stringify(value), "invalid_response"]),
      [
        JSON.stringify({ ok: false, error: { code: "meta_missing", message: "private path" } }),
        "meta_missing",
      ],
      [
        JSON.stringify({ ok: false, error: { code: "save_unsupported", message: "private data" } }),
        "save_unsupported",
      ],
    ]) {
      await writeFile(response, payload);
      expect(await native(page, "cosmetics_get")).toMatchObject({ ok: false, error: { code } });
    }
    await writeFile(response, healthy);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("searchbox", { name: "Search cosmetics" })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("private");
    await expect(
      page.getByRole("button", { name: /Unlock|Lock All|Clear All Presets|Revert|Save Changes/ }),
    ).toHaveCount(0);
    for (const command of [
      "cosmetics_write",
      "cosmetics_artwork_prepare",
      "saves_write",
      "plugin:fs|write_file",
      "plugin:shell|execute",
      "backend_run",
    ])
      await expect(
        native(page, command, { path: "Z:/private", changes: [] }),
      ).rejects.toBeDefined();
    for (const status of [
      { status: "running", running: true },
      { status: "unknown", running: false },
      null,
    ]) {
      await writeFile(
        path.join(home, "game-status.json"),
        status ? JSON.stringify({ ok: true, ...status }) : "exit7",
      );
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "");
      await writeFile(
        path.join(home, "game-status.json"),
        JSON.stringify({ ok: true, status: "not_running", running: false }),
      );
      await page.getByRole("button", { name: "Check Again", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    }
    const empty = {
      ...projection,
      catalogAvailable: false,
      knownCatalogCount: 0,
      knownOwnedCount: 0,
      knownLockedCount: 0,
      unknownOwnedIds: [],
      capabilities: {
        canReadCosmetics: true,
        canUnlockCosmetic: false,
        canUnlockAll: false,
        canRemoveOwnership: false,
      },
      cosmetics: [],
    };
    await writeFile(response, JSON.stringify({ ok: true, cosmetics: empty }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByText("No cosmetics match the current search and filters."),
    ).toBeVisible();
    expect(await native(page, "cosmetics_get")).toMatchObject({ ok: true, data: empty });
  } finally {
    await close(child, browser);
  }
});

test("slow Cosmetics keep navigation and status independent while other domain reads queue", async ({
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
    REPODITOR_TEST_DELAY_COMMAND: "cosmetics-get",
    REPODITOR_TEST_STARTED_FILE: marker,
    REPODITOR_TEST_TIMING_DIR: recordsDir,
  });
  try {
    const entryMs = await openCosmetics(page);
    await writeFile(marker, "");
    const requested = Date.now();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => readFile(marker, "utf8")).toBe("cosmetics-get");
    await writeFile(
      path.join(home, "cosmetics-get.json"),
      JSON.stringify({
        ok: true,
        cosmetics: {
          ...fixture.cosmetics,
          fingerprint: "b".repeat(64),
          cosmetics: [
            { ...fixture.cosmetics.cosmetics[0], displayName: "Fresh Global Cosmetic" },
            ...fixture.cosmetics.cosmetics.slice(1),
          ],
        },
      }),
    );
    await expect(page.getByRole("searchbox", { name: "Search cosmetics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refreshing", exact: true })).toBeDisabled();
    expect(await native(page, "cosmetics_get")).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    const queuedAt = Date.now();
    const queued = native(page, "maps_list");
    const navigating = performance.now();
    await page.getByRole("button", { name: "Run Saves", exact: true }).click();
    await page.getByRole("button", { name: "Cosmetics", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search cosmetics" }).fill("999");
    await expect(page.locator('[data-cosmetic-id="999"]')).toBeVisible();
    const navigationMs = performance.now() - navigating;
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "unknown", running: false }),
    );
    const focused = performance.now();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("dialog")).toBeVisible();
    const focusToDialogMs = performance.now() - focused;
    await expect(
      page
        .getByTestId("cosmetics-workspace")
        .getByRole("button", { name: "Refreshing", exact: true, includeHidden: true }),
    ).toBeDisabled();
    expect(await queued).toMatchObject({ ok: true });
    await expect(page.getByText("Fresh Global Cosmetic", { exact: true })).toHaveCount(1);
    const records = [];
    for (const name of await readdir(recordsDir)) {
      const record = JSON.parse(await readFile(path.join(recordsDir, name), "utf8")) as {
        operation: string;
        started: number;
        finished: number;
      };
      if (record.started >= requested) records.push(record);
    }
    const cosmeticsReads = records
      .filter((record) => record.operation === "cosmetics-get")
      .sort((a, b) => a.started - b.started);
    const cosmetics = cosmeticsReads[0];
    const status = records.find((record) => record.operation === "game-status")!;
    const maps = records.find((record) => record.operation === "maps-list")!;
    expect(cosmeticsReads).toHaveLength(2);
    expect(cosmeticsReads[1].started).toBeGreaterThanOrEqual(cosmetics.finished);
    expect(cosmetics.finished - cosmetics.started).toBeGreaterThanOrEqual(2000);
    expect(status.finished).toBeLessThan(cosmetics.finished);
    expect(maps.started).toBeGreaterThanOrEqual(cosmetics.finished);
    await writeFile(
      info.outputPath("cosmetics-scheduling.json"),
      JSON.stringify(
        {
          entryMs,
          navigationMs,
          focusToDialogMs,
          queuedPreExecutionMs: maps.started - queuedAt,
          records,
          note: "Synthetic 2s helper; queue estimate includes IPC/process startup, not production timing.",
        },
        null,
        2,
      ),
    );
  } finally {
    await close(child, browser);
  }
});

test("Cosmetics deadlines, stream bounds, startup recovery and close reap every child tree", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("lifecycle");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "cosmetics-get.json");
  const healthy = await readFile(response, "utf8");
  const pidDir = path.join(home, "pids");
  await mkdir(pidDir);
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_PID_DIR: pidDir,
  });
  let closed = false;
  try {
    await openCosmetics(page);
    for (const [mode, code] of [
      ["stdout", "malformed_response"],
      ["stderr", "malformed_response"],
      ["exit7", "process_failed"],
    ]) {
      await writeFile(response, mode);
      expect(await native(page, "cosmetics_get")).toMatchObject({ ok: false, error: { code } });
      await reaped(await processIds(pidDir, 1));
    }
    await writeFile(response, "hang");
    const started = performance.now();
    const read = native(page, "cosmetics_get");
    const ids = await processIds(pidDir);
    expect(await native(page, "cosmetics_get")).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    expect(await read).toMatchObject({ ok: false, error: { code: "process_timeout" } });
    const timeoutMs = performance.now() - started;
    expect(timeoutMs).toBeGreaterThanOrEqual(29000);
    await reaped(ids);
    await writeFile(response, healthy);
    expect(await native(page, "cosmetics_get")).toMatchObject({ ok: true });
    const backend = path.join(home, "backend/repoditor-backend.exe");
    await rename(backend, `${backend}.hidden`);
    expect(await native(page, "cosmetics_get")).toMatchObject({
      ok: false,
      error: { code: "python_unavailable" },
    });
    await rename(`${backend}.hidden`, backend);
    expect(await native(page, "cosmetics_get")).toMatchObject({ ok: true });
    await rename(path.join(pidDir, "cosmetics-get.json"), path.join(pidDir, "timed-out.json"));
    await writeFile(response, "hang");
    const pending = native(page, "cosmetics_get").catch(() => null);
    const closing = await processIds(pidDir);
    await close(child, browser);
    closed = true;
    await pending;
    await reaped(closing);
    await writeFile(
      info.outputPath("cosmetics-lifecycle.json"),
      JSON.stringify(
        { timeoutMs, timeoutAndCloseTreesReaped: true, startupAndStreamRecovery: true },
        null,
        2,
      ),
    );
  } finally {
    if (!closed) await close(child, browser);
  }
});
