import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron, expect, test, type Page, type TestInfo } from "@playwright/test";
import type { DesktopOperationResult, RunStateDto } from "../../electron/contracts.cjs";
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

function rewriteSave(savePath: string, mode: "boundaries" | "subset" | "changed") {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      [
        "import json,sys",
        "from pathlib import Path",
        "from repo_save_editor.core.crypto import encrypt_save",
        "data=json.loads(Path(sys.argv[1]).read_text())",
        "stats=data['dictionaryOfDictionaries']['value']['runStats']",
        "stats.update({'level':2147483647,'currency':-9007199254740991,'lives':0,'totalHaul':9007199254740991,'save level':9})",
        "if sys.argv[3]=='subset': del stats['lives']; del stats['totalHaul']",
        "if sys.argv[3]=='changed': stats.update({'level':0,'currency':37,'lives':-3,'totalHaul':0,'save level':1})",
        "Path(sys.argv[2]).write_bytes(encrypt_save(data))",
      ].join("\n"),
      path.join(DESKTOP_ROOT, "e2e/fixtures/save.json"),
      savePath,
      mode,
    ],
    { cwd: PYTHON_ROOT, env: { ...process.env, PYTHONPATH: PYTHON_ROOT }, windowsHide: true },
  );
}

async function openRun(page: Page, reference = false) {
  await page.getByRole("button", { name: /Open workspace/ }).click();
  if (reference) await waitForWorkspaceOrContinue(page);
  await page.getByRole("tab", { name: "Run", exact: true }).click();
}

async function compareRun(page: Page, reference: Page) {
  await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toBeVisible();
  const actual = await native<DesktopOperationResult<RunStateDto>>(page, "run_get", {
    saveId: E2E_SAVE_ID,
  });
  const expected = await reference.evaluate((id) => window.repoditor.run.get(id), E2E_SAVE_ID);
  expect(actual.ok).toBe(true);
  expect(actual).toEqual(expected);
  if (!actual.ok) throw new Error("Synthetic Run could not be read");
  for (const stat of actual.data.stats) {
    const value = page.getByRole("textbox", { name: stat.label, exact: true });
    await expect(value).toHaveValue(String(stat.value));
    await expect(value).toHaveValue(
      await reference.getByRole("spinbutton", { name: stat.label, exact: true }).inputValue(),
    );
    await expect(value).toHaveAttribute("readonly", "");
    expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const labelBox = await page.locator(`label[for="run-${stat.key}"]`).boundingBox();
    const valueBox = await value.boundingBox();
    expect(valueBox!.y).toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height);
  }
  await expect(page.getByRole("textbox", { name: "Resume location" })).toHaveValue(
    actual.data.resumeLocation.value,
  );
  await expect(reference.getByRole("combobox", { name: "Resume location" })).toContainText(
    actual.data.resumeLocation.value,
  );
  await expect(page.getByRole("textbox")).toHaveCount(actual.data.stats.length + 1);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Revert|Save Changes/ })).toHaveCount(0);
  await expect(page.locator('[data-testid^="pending-run-"]')).toHaveCount(0);
  return actual.data;
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
    await page.screenshot({ path: info.outputPath(`native-run-${size.width}.png`) });
    await reference.screenshot({ path: info.outputPath(`electron-run-${size.width}.png`) });
  }
}

test("packaged Run preserves signed values, subsets and resume semantics against Electron without writes", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("comparison");
  await mkdir(home, { recursive: true });
  const savePath = await createRunSaveFixture(home);
  rewriteSave(savePath, "boundaries");
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
    await openRun(referencePage, true);
    const clicked = performance.now();
    await openRun(page);
    await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toHaveValue(
      "-9007199254740991",
    );
    await writeFile(
      info.outputPath("run-open-timing.json"),
      JSON.stringify({ openToRunValueMs: performance.now() - clicked }),
    );
    const initial = await compareRun(page, referencePage);
    expect(initial.stats.map((stat) => stat.value)).toEqual([
      2147483648, -9007199254740991, 0, 9007199254740991,
    ]);
    expect(initial.resumeLocation.options).toContain("Unknown (9)");
    await page.getByRole("tab", { name: "Upgrades" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Run", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const level = page.getByRole("textbox", { name: "Level", exact: true });
    await expect(level).toBeFocused();
    await page.keyboard.press("Control+A");
    expect(
      await level.evaluate(
        (element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!,
      ),
    ).toBe(10);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.type("7");
    await expect(level).toHaveValue("2147483648");
    await compareLayouts(page, referencePage, info);
    expect(await readFile(savePath)).toEqual(original);
    for (const mode of ["subset", "changed"] as const) {
      rewriteSave(savePath, mode);
      const source = await readFile(savePath);
      // The direct read is fresh even while the workspace retains its original projection.
      expect(await native(page, "run_get", { saveId: E2E_SAVE_ID })).toEqual(
        await referencePage.evaluate((id) => window.repoditor.run.get(id), E2E_SAVE_ID),
      );
      for (const target of [page, referencePage]) {
        await target.getByRole("button", { name: "Change save" }).click();
        await openRun(target, target === referencePage);
      }
      const data = await compareRun(page, referencePage);
      expect(data.stats.map((stat) => stat.value)).toEqual(
        mode === "subset" ? [2147483648, -9007199254740991] : [1, 37, -3, 0],
      );
      expect(data.resumeLocation.value).toBe(
        mode === "subset" ? "Unknown (9)" : "Shop / Service Station",
      );
      expect(await readFile(savePath)).toEqual(source);
    }
    await rename(savePath, `${savePath}.hidden`);
    const missing = await native(page, "run_get", { saveId: E2E_SAVE_ID });
    expect(missing).toMatchObject({ ok: false, error: { code: "save_missing" } });
    expect(missing).toEqual(
      await referencePage.evaluate((id) => window.repoditor.run.get(id), E2E_SAVE_ID),
    );
    await rename(`${savePath}.hidden`, savePath);
    await writeFile(savePath, "bad");
    const corrupt = await native(page, "run_get", { saveId: E2E_SAVE_ID });
    expect(corrupt).toMatchObject({ ok: false, error: { code: "save_corrupt" } });
    expect(corrupt).toEqual(
      await referencePage.evaluate((id) => window.repoditor.run.get(id), E2E_SAVE_ID),
    );
    expect(await readFile(savePath, "utf8")).toBe("bad");
  } finally {
    try {
      if (preview) await close(preview.child, preview.browser);
    } finally {
      await reference.close();
    }
  }
});

test("native Run validates malformed responses, recovers and keeps unknown game status fail closed", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("failures");
  const fixture = await stageSyntheticBackend(home);
  const response = path.join(home, "run-get.json");
  const healthy = await readFile(response, "utf8");
  await writeFile(response, "exit7");
  const { child, browser, page } = await launch(fixture.executable, home, fixture.environment);
  try {
    await openRun(page);
    await expect(page.getByRole("alert")).toBeVisible();
    for (const saveId of [null, 42, "../save.es3", "--help", `${E2E_SAVE_ID}\n`])
      expect(await native(page, "run_get", { saveId })).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    expect(await native(page, "run_get")).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    const stat = fixture.run.stats[0];
    const invalidRuns = [
      { ...fixture.run, stats: [stat, stat] },
      { ...fixture.run, stats: [{ ...stat, key: "unknown" }] },
      ...[0, -1, true, "5", 1.5, 9007199254740992].map((value) => ({
        ...fixture.run,
        stats: [{ ...stat, value }],
      })),
      { ...fixture.run, resumeLocation: { value: "Normal", options: ["Normal", "Normal"] } },
      { ...fixture.run, resumeLocation: { value: "Unknown (9)", options: ["Normal"] } },
      { ...fixture.run, resumeLocation: { value: "Normal", options: [null] } },
    ];
    for (const [payload, code] of [
      ["{", "malformed_response"],
      [JSON.stringify({ ok: true }), "invalid_response"],
      ...invalidRuns.map((run) => [JSON.stringify({ ok: true, run }), "invalid_response"]),
      [
        JSON.stringify({ ok: false, error: { code: "save_missing", message: "private path" } }),
        "save_missing",
      ],
      [
        JSON.stringify({
          ok: false,
          error: { code: "save_write_failed", message: "private path" },
        }),
        "invalid_response",
      ],
    ]) {
      await writeFile(response, payload);
      expect(await native(page, "run_get", { saveId: E2E_SAVE_ID })).toMatchObject({
        ok: false,
        error: { code },
      });
      await page.getByRole("button", { name: "Change save" }).click();
      await openRun(page);
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await page.locator("body").innerText()).not.toContain("private");
    }
    await writeFile(response, healthy);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toHaveValue("12");
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
      await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toHaveValue("12");
    }
    await writeFile(response, JSON.stringify({ ok: true, run: { ...fixture.run, stats: [] } }));
    await page.getByRole("button", { name: "Change save" }).click();
    await openRun(page);
    await expect(page.getByRole("textbox", { name: "Resume location" })).toHaveValue("Normal");
    await expect(page.getByRole("textbox")).toHaveCount(1);
  } finally {
    await close(child, browser);
  }
});
