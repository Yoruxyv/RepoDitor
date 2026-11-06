import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type Page, type TestInfo } from "@playwright/test";
import type { AdvancedSaveDto, DesktopOperationResult } from "../../electron/contracts.cjs";
import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  PYTHON_ROOT,
  createRunSaveFixture,
  getPythonExecutable,
  isolatedApplicationEnvironment,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import { close, launch, native, stageSyntheticBackend } from "../support/tauriHarness";
import { waitForWorkspaceOrContinue } from "../support/waits";

function rewriteSave(savePath: string, mode: "rich" | "changed" | "missing" | "empty") {
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
        "values['item'].update({'Item Melee Inflatable Hammer/2':21,'Item Future Tool/1':7,'Item Future Tool/2':8})",
        "values['itemStatBattery'].update({'Item Future Tool/2':-7,'Item Orphan/1':1})",
        "values['playerUpgradeHealth']={'111':2}",
        "if sys.argv[3]=='changed': values['itemStatBattery']['Item Melee Inflatable Hammer/1']=9007199254740991",
        "if sys.argv[3]=='missing': del values['item']",
        "if sys.argv[3]=='empty': values['item']={}",
        "Path(sys.argv[2]).write_bytes(encrypt_save(data))",
      ].join("\n"),
      path.join(DESKTOP_ROOT, "e2e/fixtures/save.json"),
      savePath,
      mode,
    ],
    { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT }, windowsHide: true },
  );
}

async function openItems(page: Page, reference = false) {
  await page.getByRole("button", { name: /Open workspace/ }).click();
  if (reference) await waitForWorkspaceOrContinue(page);
  const tab = page.getByRole("tab", { name: "Items", exact: true });
  await tab.waitFor({ state: "visible" });
  const started = performance.now();
  await tab.click();
  return started;
}

async function compareDto(page: Page, reference: Page) {
  const actual = await native<DesktopOperationResult<AdvancedSaveDto>>(page, "advanced_get", {
    saveId: E2E_SAVE_ID,
  });
  const expected = await reference.evaluate((id) => window.repoditor.advanced.get(id), E2E_SAVE_ID);
  expect(actual.ok).toBe(true);
  expect(expected.ok).toBe(true);
  if (!actual.ok || !expected.ok) throw new Error("Synthetic Items could not be read");
  expect(actual.data).toEqual({
    ...expected.data,
    items: expected.data.items.map((item) => ({ ...item, iconToken: null })),
  });
  expect(actual.data.domains).toHaveLength(6);
  expect(JSON.stringify(actual)).not.toContain("rechargeEvidence");
  for (const item of actual.data.items) {
    expect(item.saveKey).toBe(`Item ${item.name}/${item.instanceId}`);
    expect(item.iconToken).toBeNull();
  }
  return actual.data;
}

async function choose(page: Page, label: string, option: string) {
  const control = page.getByRole("combobox", { name: label, exact: true });
  await control.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(control).toBeFocused();
}

async function compareInteractions(page: Page, reference: Page) {
  for (const target of [page, reference]) {
    await target.getByRole("searchbox", { name: "Search items" }).fill("  HAMMER  ");
    await expect(target.getByText("2 matching items")).toBeVisible();
    await expect(target.getByTestId("item-instance-Item Melee Inflatable Hammer/1")).toContainText(
      "Current charge: 99",
    );
    await expect(target.getByTestId("item-instance-Item Melee Inflatable Hammer/2")).toContainText(
      "Full",
    );
    await target.getByRole("button", { name: "Clear item search" }).click();
    await expect(target.getByRole("searchbox", { name: "Search items" })).toBeFocused();
  }
  for (const option of ["Rechargeable items", "Non-rechargeable items", "Upgrades", "All items"]) {
    for (const target of [page, reference]) await choose(target, "Filter", option);
    expect(
      await page
        .locator('[data-testid^="item-group-"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid"))),
    ).toEqual(
      await reference
        .locator('[data-testid^="item-group-"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid"))),
    );
  }
  for (const option of ["Name Z–A", "Quantity high to low", "Name A–Z"]) {
    for (const target of [page, reference]) await choose(target, "Sort", option);
    expect(
      await page
        .locator('[data-testid^="item-group-"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid"))),
    ).toEqual(
      await reference
        .locator('[data-testid^="item-group-"]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-testid"))),
    );
  }
  await page.getByRole("searchbox", { name: "Search items" }).fill("no such item");
  await expect(page.getByText("No items match this search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear item search" }).click();
  await expect(page.getByRole("button", { name: /Recharge|Revert|Save Changes/ })).toHaveCount(0);
  await expect(page.getByText(/Pending:/)).toHaveCount(0);
  await expect(page.locator('img[src^="repoditor-icon:"]')).toHaveCount(0);
  await expect(page.getByTestId("item-icon-Item Upgrade Player Health/1")).toHaveAttribute(
    "data-icon-source",
    "specific",
  );
  await expect(page.getByTestId("item-icon-Item Future Tool/1")).toHaveAttribute(
    "data-icon-source",
    "fallback",
  );
  for (const icon of await page.locator('[data-testid^="item-icon-"]').all())
    await expect(icon).not.toHaveAttribute("data-icon-source", "local");
}

async function layouts(page: Page, reference: Page, info: TestInfo) {
  for (const size of [
    { width: 1600, height: 900 },
    { width: 1200, height: 800 },
    { width: 960, height: 640 },
  ]) {
    for (const target of [page, reference]) {
      await target.setViewportSize(size);
      await target.evaluate(() => window.scrollTo(0, 0));
      expect(
        await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`native-items-${size.width}.png`) });
    await reference.screenshot({ path: info.outputPath(`electron-items-${size.width}.png`) });
  }
}

test("packaged Items preserve evidence, dynamic instances and readonly search/filter/sort parity", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("comparison");
  await mkdir(home, { recursive: true });
  const savePath = await createRunSaveFixture(home);
  rewriteSave(savePath, "rich");
  await createGameFixture(home);
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
    const original = await readFile(savePath);
    const referenceOpened = performance.now();
    const referenceTab = await openItems(referencePage, true);
    await expect(referencePage.getByRole("searchbox", { name: "Search items" })).toBeVisible();
    const referenceVisible = performance.now();
    const clicked = performance.now();
    const itemsTab = await openItems(page);
    await expect(page.getByRole("searchbox", { name: "Search items" })).toBeVisible();
    const nativeVisible = performance.now();
    await writeFile(
      info.outputPath("items-open-timing.json"),
      JSON.stringify({
        openToItemsValueMs: nativeVisible - clicked,
        itemsTabToValueMs: nativeVisible - itemsTab,
        electronOpenToItemsValueMs: referenceVisible - referenceOpened,
        electronItemsTabToValueMs: referenceVisible - referenceTab,
      }),
    );
    const initial = await compareDto(page, referencePage);
    expect(initial.items.map((item) => item.chargeState)).toEqual(
      expect.arrayContaining(["stored", "default_full", "not_applicable", "unknown"]),
    );
    expect(initial.unlinkedChargeEntryCount).toBe(1);
    await page.getByRole("tab", { name: "Run", exact: true }).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Maps", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Items", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("searchbox", { name: "Search items" })).toBeFocused();
    await compareInteractions(page, referencePage);
    await layouts(page, referencePage, info);
    expect(await readFile(savePath)).toEqual(original);
    rewriteSave(savePath, "changed");
    const changed = await readFile(savePath);
    expect(
      (await compareDto(page, referencePage)).items.find(
        (item) => item.saveKey === "Item Melee Inflatable Hammer/1",
      )?.storedCharge,
    ).toBe(9007199254740991);
    for (const target of [page, referencePage]) {
      await target.getByRole("button", { name: "Change save" }).click();
      await openItems(target, target === referencePage);
      await expect(
        target.getByTestId("item-instance-Item Melee Inflatable Hammer/1"),
      ).toContainText("Current charge: 9007199254740991");
    }
    expect(await readFile(savePath)).toEqual(changed);
    await rename(savePath, `${savePath}.hidden`);
    const missing = await native(page, "advanced_get", { saveId: E2E_SAVE_ID });
    expect(missing).toMatchObject({ ok: false, error: { code: "save_missing" } });
    expect(missing).toEqual(
      await referencePage.evaluate((id) => window.repoditor.advanced.get(id), E2E_SAVE_ID),
    );
    await rename(`${savePath}.hidden`, savePath);
    await writeFile(savePath, "bad");
    const corrupt = await native(page, "advanced_get", { saveId: E2E_SAVE_ID });
    expect(corrupt).toMatchObject({ ok: false, error: { code: "save_corrupt" } });
    expect(corrupt).toEqual(
      await referencePage.evaluate((id) => window.repoditor.advanced.get(id), E2E_SAVE_ID),
    );
    expect(await readFile(savePath, "utf8")).toBe("bad");
    for (const mode of ["missing", "empty"] as const) {
      rewriteSave(savePath, mode);
      const source = await readFile(savePath);
      for (const target of [page, referencePage]) {
        await target.getByRole("button", { name: "Change save" }).click();
        await openItems(target, target === referencePage);
        await expect(
          target.getByText(
            mode === "missing"
              ? "Items are unavailable for this save."
              : "This save contains no item instances.",
          ),
        ).toBeVisible();
      }
      expect((await compareDto(page, referencePage)).items).toEqual([]);
      expect(await readFile(savePath)).toEqual(source);
    }
  } finally {
    try {
      if (preview) await close(preview.child, preview.browser);
    } finally {
      await reference.close();
    }
  }
});

test("native Items reject malformed identities, capabilities, states and metadata then recover", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("failures");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "advanced-get.json");
  const healthy = await readFile(response, "utf8");
  await writeFile(response, "exit7");
  const { child, browser, page } = await launch(fixture.executable, home, fixture.environment);
  try {
    await openItems(page);
    await expect(page.getByRole("alert")).toBeVisible();
    for (const saveId of [null, 42, "../save.es3", "--help", `${E2E_SAVE_ID}\n`])
      expect(await native(page, "advanced_get", { saveId })).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    expect(await native(page, "advanced_get")).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    const item = fixture.advanced.items[0];
    const invalid = [
      { ...fixture.advanced, domains: [] },
      {
        ...fixture.advanced,
        domains: fixture.advanced.domains.map(() => fixture.advanced.domains[0]),
      },
      { ...fixture.advanced, items: [item, item] },
      ...[
        { instanceId: "2" },
        { name: "Wrong" },
        { storedCharge: null },
        { storedCharge: true },
        { chargeState: "default_full" },
        { rechargeCapability: "unknown" },
        { iconKey: "../secret.png" },
        { upgradeVisualKey: "playerUpgradeHealth" },
      ].map((fields) => ({ ...fixture.advanced, items: [{ ...item, ...fields }] })),
      {
        ...fixture.advanced,
        domains: fixture.advanced.domains.map((domain) => ({
          ...domain,
          capabilities: { ...domain.capabilities, canEdit: true },
        })),
      },
      { ...fixture.advanced, unlinkedChargeEntryCount: -1 },
    ];
    for (const [payload, code] of [
      ["{", "malformed_response"],
      [JSON.stringify({ ok: true }), "invalid_response"],
      ...invalid.map((advanced) => [JSON.stringify({ ok: true, advanced }), "invalid_response"]),
      [
        JSON.stringify({ ok: false, error: { code: "save_missing", message: "private path" } }),
        "save_missing",
      ],
    ]) {
      await writeFile(response, payload);
      expect(await native(page, "advanced_get", { saveId: E2E_SAVE_ID })).toMatchObject({
        ok: false,
        error: { code },
      });
      await page.getByRole("button", { name: "Change save" }).click();
      await openItems(page);
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("private");
    }
    await writeFile(response, healthy);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("item-instance-Item Melee Inflatable Hammer/1")).toContainText(
      "Current charge: 99",
    );
    expect(await native(page, "advanced_get", { saveId: E2E_SAVE_ID })).toMatchObject({ ok: true });
    for (const payload of [
      JSON.stringify({ ok: true, status: "unknown", running: false }),
      JSON.stringify({ ok: true, status: "running", running: true }),
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
  } finally {
    await close(child, browser);
  }
});

test("a controlled expensive Items read keeps UI and game-status checks independent", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("scheduling");
  const fixture = await stageSyntheticBackend(home);
  const marker = path.join(home, "started.txt");
  const timingDir = path.join(home, "records");
  await mkdir(timingDir);
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_DELAY_MS: "2000",
    REPODITOR_TEST_DELAY_COMMAND: "advanced-get",
    REPODITOR_TEST_STARTED_FILE: marker,
    REPODITOR_TEST_TIMING_DIR: timingDir,
  });
  try {
    await openItems(page);
    await expect(page.getByRole("searchbox", { name: "Search items" })).toBeVisible();
    await writeFile(marker, "");
    const requested = Date.now();
    let finished = false;
    const read = native(page, "advanced_get", { saveId: E2E_SAVE_ID }).then((result) => {
      finished = true;
      return result;
    });
    await expect.poll(async () => readFile(marker, "utf8")).toBe("advanced-get");
    const uiStarted = performance.now();
    await page.getByRole("searchbox", { name: "Search items" }).fill("hammer");
    await expect(page.getByText("1 matching item")).toBeVisible();
    const uiElapsedMs = performance.now() - uiStarted;
    expect(finished).toBe(false);
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "unknown", running: false }),
    );
    const focusStarted = performance.now();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("editor-content")).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("dialog")).toBeVisible();
    const focusToSafetyDialogMs = performance.now() - focusStarted;
    await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "");
    expect(finished).toBe(false);
    expect(await read).toMatchObject({ ok: true });
    const records = [];
    for (const name of await readdir(timingDir)) {
      const record = JSON.parse(await readFile(path.join(timingDir, name), "utf8")) as {
        operation: string;
        started: number;
        finished: number;
      };
      if (record.started >= requested) records.push(record);
    }
    const items = records.find((record) => record.operation === "advanced-get")!;
    const game = records.find((record) => record.operation === "game-status")!;
    expect(items.finished - items.started).toBeGreaterThanOrEqual(2000);
    expect(game.started).toBeLessThan(items.finished);
    await writeFile(
      info.outputPath("items-scheduling.json"),
      JSON.stringify(
        {
          uiElapsedMs,
          focusToSafetyDialogMs,
          records,
          note: "Synthetic 2s Items backend, not production work. UI retains previous known status during recheck, then blocks on unknown as in Electron. Game status executes independently of active Items; deadlines remain unchanged.",
        },
        null,
        2,
      ),
    );
  } finally {
    await close(child, browser);
  }
});
