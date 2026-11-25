import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type {
  DesktopOperationResult,
  PlayerUpgradeDto,
} from "../../../renderer/app/tauri/desktopContracts";
import {
  DESKTOP_ROOT,
  E2E_SAVE_ID,
  PYTHON_ROOT,
  createRunSaveFixture,
  getPythonExecutable,
} from "../../support/fixtures/fixtureEnvironment";
import { createGameFixture } from "../../support/harness/harness";
import {
  close,
  launch,
  native,
  stageSyntheticBackend,
  stopSyntheticGame,
} from "../../support/harness/tauriHarness";

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

async function openUpgrades(page: Page) {
  await page.getByRole("button", { name: /Open workspace/ }).click();
  await page.getByRole("tab", { name: "Upgrades" }).click();
}

async function compareValues(page: Page, name: string) {
  const result = await native<DesktopOperationResult<PlayerUpgradeDto[]>>(page, "upgrades_list", {
    saveId: E2E_SAVE_ID,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Synthetic upgrades could not be read");
  for (const item of result.data) {
    if (item.iconToken !== null) expect(item.iconToken).toMatch(/^upgrade-artwork:[0-9a-f]{32}$/);
  }
  for (const upgrade of result.data) {
    const label = `${upgrade.label} for ${name}`;
    await expect(page.getByRole("textbox", { name: label })).toHaveValue(
      String(
        upgrade.values.find(({ playerId }) => playerId === (name === "Alpha" ? "111" : "222"))
          ?.value ?? 0,
      ),
    );
    await expect(page.getByTestId(`upgrade-icon-${upgrade.key}`)).not.toHaveAttribute(
      "data-icon-source",
      "local",
    );
  }
  return result.data;
}

async function compareLayouts(page: Page, info: TestInfo) {
  for (const size of [
    { width: 1600, height: 900 },
    { width: 1200, height: 800 },
    { width: 960, height: 640 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`native-upgrades-${size.width}.png`) });
  }
}

test("packaged Upgrades retain dynamic values, shared selection and read-only layout", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("comparison");
  await mkdir(home, { recursive: true });
  const savePath = await createRunSaveFixture(home);
  rewriteSave(savePath, "dynamic");
  const original = await readFile(savePath);
  const gameRoot = await createGameFixture(home);
  let preview: Awaited<ReturnType<typeof launch>> | undefined;
  let game: ChildProcess | undefined;
  try {
    preview = await launch(
      path.resolve(DESKTOP_ROOT, process.env["REPODITOR_E2E_EXECUTABLE"]!),
      home,
    );
    const page = preview.page;
    const clicked = performance.now();
    await openUpgrades(page);
    await expect(page.getByRole("textbox", { name: "Future Boost for Alpha" })).toHaveValue(
      "2147483648",
    );
    await writeFile(
      info.outputPath("upgrades-open-timing.json"),
      JSON.stringify({ openToUpgradeValueMs: performance.now() - clicked }),
    );
    const catalog = await compareValues(page, "Alpha");
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
    await page.getByRole("combobox", { name: "Player" }).click();
    await page.getByRole("option", { name: "Beta", exact: true }).click();
    await compareValues(page, "Beta");
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("button", { name: /Beta/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("tab", { name: "Players" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Upgrades" })).toBeFocused();
    await expect(page.getByTestId("selected-player-identity")).toContainText("Beta");
    await compareLayouts(page, info);
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
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("heading", { name: "R.E.P.O. is currently running" }),
    ).toBeVisible();
    await stopSyntheticGame(game);
    await page.getByRole("button", { name: "Check Again" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    rewriteSave(savePath, "changed");
    const changed = await readFile(savePath);
    const read = await native<DesktopOperationResult<PlayerUpgradeDto[]>>(page, "upgrades_list", {
      saveId: E2E_SAVE_ID,
    });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("Changed synthetic upgrades could not be read");
    expect(read.data.every((item) => item.iconToken === null)).toBe(true);
    expect(read.data.find((item) => item.key === "playerUpgradeFutureBoost")?.values).toEqual([
      { playerId: "111", value: 37 },
    ]);
    await page.getByRole("button", { name: "Change save" }).click();
    await openUpgrades(page);
    await expect(page.getByRole("textbox", { name: "Future Boost for Alpha" })).toHaveValue("37");
    await compareValues(page, "Alpha");
    expect(await readFile(savePath)).toEqual(changed);
    await rename(savePath, `${savePath}.hidden`);
    expect(await native(page, "upgrades_list", { saveId: E2E_SAVE_ID })).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "save_missing" }),
      }),
    );
    await rename(`${savePath}.hidden`, savePath);
    await writeFile(savePath, "bad");
    const corrupt = await native(page, "upgrades_list", { saveId: E2E_SAVE_ID });
    expect(corrupt).toMatchObject({ ok: false, error: { code: "save_corrupt" } });
    expect(await readFile(savePath, "utf8")).toBe("bad");
    rewriteSave(savePath, "empty");
    const empty = await readFile(savePath);
    await page.getByRole("button", { name: "Change save" }).click();
    await openUpgrades(page);
    await expect(page.getByText("This save contains no player upgrades.")).toBeVisible();
    expect(await native(page, "upgrades_list", { saveId: E2E_SAVE_ID })).toEqual({
      ok: true,
      data: [],
    });
    expect(await readFile(savePath)).toEqual(empty);
  } finally {
    try {
      await stopSyntheticGame(game);
    } finally {
      if (preview) await close(preview.child, preview.browser);
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
      JSON.stringify({ ok: true, fingerprint: fixture.opened.session.fingerprint, players: [] }),
    );
    await page.getByRole("button", { name: "Change save" }).click();
    await openUpgrades(page);
    await expect(page.getByText("This save does not contain player records.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /for Alpha/ })).toHaveCount(0);
  } finally {
    await close(child, browser);
  }
});
