import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { DESKTOP_ROOT, E2E_SAVE_ID } from "../support/fixtureEnvironment";
import { close, launch, native, stageSyntheticBackend } from "../support/tauriHarness";

async function openItems(page: Page) {
  await page.getByRole("button", { name: /Open workspace/ }).click();
  await page.getByRole("tab", { name: "Items", exact: true }).click();
  await expect(page.getByTestId("item-instance-Item Melee Inflatable Hammer/1")).toContainText(
    "99",
  );
  await page.getByRole("tab", { name: "Upgrades" }).click();
  await expect(page.getByRole("textbox", { name: "Strength for Alpha" })).toHaveValue("2");
  await page.getByRole("tab", { name: "Run", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Currency", exact: true })).toHaveValue("12");
  await page.getByRole("tab", { name: "Items", exact: true }).click();
  await expect(page.getByTestId("editor-content")).toHaveAttribute("aria-busy", "false");
}

async function pids(home: string, command: string, count = 2): Promise<number[]> {
  let result: number[] = [];
  await expect
    .poll(async () => {
      try {
        result = JSON.parse(await readFile(path.join(home, `${command}.json`), "utf8")) as number[];
        return result.length;
      } catch {
        return 0;
      }
    })
    .toBe(count);
  return result;
}

async function reaped(ids: number[]) {
  await expect
    .poll(() =>
      ids.every((pid) => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          return (error as NodeJS.ErrnoException).code === "ESRCH";
        }
      }),
    )
    .toBe(true);
}

async function probe(info: TestInfo, independent: boolean, executable?: string) {
  const home = info.outputPath(independent ? "after" : "before");
  const fixture = await stageSyntheticBackend(home);
  if (executable) await copyFile(path.resolve(DESKTOP_ROOT, executable), fixture.executable);
  const marker = path.join(home, "started.txt");
  const timing = path.join(home, "records");
  await mkdir(timing);
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_DELAY_MS: "2000",
    REPODITOR_TEST_DELAY_COMMAND: "advanced-get",
    REPODITOR_TEST_STARTED_FILE: marker,
    REPODITOR_TEST_TIMING_DIR: timing,
  });
  try {
    await openItems(page);
    await writeFile(marker, "");
    const requested = Date.now();
    let finished = false;
    const read = native(page, "advanced_get", { saveId: E2E_SAVE_ID }).then((value) => {
      finished = true;
      return value;
    });
    await expect.poll(async () => readFile(marker, "utf8")).toBe("advanced-get");
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "unknown", running: false }),
    );
    const focus = performance.now();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("dialog")).toBeVisible();
    const focusToDialogMs = performance.now() - focus;
    expect(finished).toBe(!independent);
    await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "");
    expect(await read).toMatchObject({ ok: true });
    const records = [];
    for (const file of await readdir(timing)) {
      const record = JSON.parse(await readFile(path.join(timing, file), "utf8")) as {
        operation: string;
        started: number;
        finished: number;
      };
      if (record.started >= requested) records.push(record);
    }
    const items = records.find((record) => record.operation === "advanced-get")!;
    const game = records.find((record) => record.operation === "game-status")!;
    expect(items.finished - items.started).toBeGreaterThanOrEqual(2000);
    if (independent) expect(game.started).toBeLessThan(items.finished);
    else expect(game.started).toBeGreaterThanOrEqual(items.finished);
    return { focusToDialogMs, records };
  } finally {
    await close(child, browser);
  }
}

test("status becomes available during slow Items with an optional exact baseline comparison", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const baseline = process.env["REPODITOR_E2E_BASELINE_EXECUTABLE"];
  const before = baseline ? await probe(info, false, baseline) : null;
  const after = await probe(info, true);
  await writeFile(
    info.outputPath("status-before-after.json"),
    JSON.stringify(
      {
        before,
        after,
        note: "Identical synthetic 2s Items delay, fixture executable and settled workspace. Baseline comparison is optional for clean checkouts; the independent-status regression always runs. Not a production benchmark.",
      },
      null,
      2,
    ),
  );
});

test("status failures and startup/stream errors stay fail closed and release their processes", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("failures");
  const fixture = await stageSyntheticBackend(home);
  const pidDir = path.join(home, "pids");
  await mkdir(pidDir);
  const healthy = JSON.stringify({ ok: true, status: "not_running", running: false });
  const response = path.join(home, "game-status.json");
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_PID_DIR: pidDir,
  });
  try {
    await openItems(page);
    for (const payload of [
      "{",
      "exit7",
      "stdout",
      "stderr",
      JSON.stringify({ ok: true, status: "future", running: false }),
      JSON.stringify({ ok: true, status: "unknown", running: false }),
      JSON.stringify({ ok: true, status: "running", running: true }),
    ]) {
      await writeFile(response, payload);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "");
      expect(await page.locator("body").innerText()).not.toContain("private");
      if (["exit7", "stdout", "stderr"].includes(payload))
        await reaped(await pids(pidDir, "game-status", 1));
      await writeFile(response, healthy);
      await page.getByRole("button", { name: "Check Again" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    const backend = path.join(home, "backend/repoditor-backend.exe");
    await rename(backend, `${backend}.hidden`);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await native(page, "game_status")).toMatchObject({
      ok: false,
      error: { code: "python_unavailable" },
    });
    await rename(`${backend}.hidden`, backend);
    await page.getByRole("button", { name: "Check Again" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await close(child, browser);
  }
});

test("normal close reaps both active trees and cancels queued domain work", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("closing");
  const fixture = await stageSyntheticBackend(home);
  const pidDir = path.join(home, "pids");
  await mkdir(pidDir);
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_PID_DIR: pidDir,
  });
  const pending: Promise<unknown>[] = [];
  const ids: number[] = [];
  try {
    await openItems(page);
    await writeFile(path.join(home, "advanced-get.json"), "hang");
    pending.push(native(page, "advanced_get", { saveId: E2E_SAVE_ID }).catch(() => null));
    ids.push(...(await pids(pidDir, "advanced-get")));
    await writeFile(path.join(home, "game-status.json"), "hang");
    pending.push(native(page, "game_status").catch(() => null));
    ids.push(...(await pids(pidDir, "game-status")));
    expect(await native(page, "game_status")).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    await writeFile(path.join(home, "players-list.json"), "hang");
    pending.push(native(page, "players_list", { saveId: E2E_SAVE_ID }).catch(() => null));
    expect(await native(page, "players_list", { saveId: E2E_SAVE_ID })).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
  } finally {
    await close(child, browser);
    await Promise.all(pending);
  }
  expect(ids).toHaveLength(4);
  await reaped(ids);
  expect(await readdir(pidDir)).not.toContain("players-list.json");
});

test("concurrent status and Items deadlines reclaim both trees, fail closed and allow retry", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("timeout");
  const fixture = await stageSyntheticBackend(home);
  const healthyItems = await readFile(path.join(home, "advanced-get.json"), "utf8");
  const pidDir = path.join(home, "pids");
  await mkdir(pidDir);
  const { child, browser, page } = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_PID_DIR: pidDir,
  });
  try {
    await openItems(page);
    await writeFile(path.join(home, "advanced-get.json"), "hang");
    const items = native(page, "advanced_get", { saveId: E2E_SAVE_ID });
    const ids = await pids(pidDir, "advanced-get");
    await writeFile(path.join(home, "game-status.json"), "hang");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    ids.push(...(await pids(pidDir, "game-status")));
    expect(await native(page, "game_status")).toMatchObject({
      ok: false,
      error: { code: "process_failed" },
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 35_000 });
    await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "");
    expect(await items).toMatchObject({ ok: false, error: { code: "process_timeout" } });
    expect(ids).toHaveLength(4);
    await reaped(ids);
    await writeFile(path.join(home, "advanced-get.json"), healthyItems);
    await writeFile(
      path.join(home, "game-status.json"),
      JSON.stringify({ ok: true, status: "not_running", running: false }),
    );
    await page.getByRole("button", { name: "Check Again" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await native(page, "advanced_get", { saveId: E2E_SAVE_ID })).toMatchObject({ ok: true });
  } finally {
    await close(child, browser);
  }
});
