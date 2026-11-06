/** Installed artwork is opt-in, read-only, and never copied into fixtures or artifacts. */
import { lstat } from "node:fs/promises";
import path from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { launchSourceE2eHarness } from "../support/harness";
import { waitForWorkspaceOrContinue } from "../support/waits";

const installedRoot = process.env.REPODITOR_MAPS_GAME_ROOT;

async function mapDecoderPids(application: ElectronApplication): Promise<number[]> {
  return application.evaluate(({ app }) => {
    const { createRequire } = process.getBuiltinModule("module");
    const fromApp = createRequire(`${app.getAppPath()}/package.json`);
    const { pythonClient } = fromApp("./dist-electron/python/client.cjs") as {
      pythonClient: { activeChildren: Set<{ pid?: number; spawnargs: string[] }> };
    };
    return [...pythonClient.activeChildren]
      .filter((child) => child.spawnargs.includes("maps-artwork"))
      .flatMap((child) => (child.pid === undefined ? [] : [child.pid]));
  });
}

test("map fallbacks remain usable at the minimum desktop size", async () => {
  const harness = await launchSourceE2eHarness();
  try {
    const { page, application } = harness;
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Modded Moon" })).toBeVisible();
    await expect(page.getByTestId("map-artwork-Modded Moon")).toHaveAttribute(
      "data-icon-source",
      "fallback",
    );
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const first = await page.getByTestId("map-artwork-Arctic").boundingBox();
    expect(first!.width).toBeGreaterThan(200);
    expect(first!.width / first!.height).toBeCloseTo(2, 1);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await refresh.focus();
    await page.keyboard.press("Enter");
    await expect(refresh).toBeEnabled();
    await expect(page.getByRole("heading", { name: "McJannek Station" })).toBeVisible();
  } finally {
    await harness.dispose();
  }
});

test("verified previews reuse caches across navigation and application relaunch", async () => {
  // Copyrighted installed artwork cannot be provided in CI fixtures; this check is explicitly opt-in.
  test.skip(!installedRoot, "Set REPODITOR_MAPS_GAME_ROOT to the read-only verified installation.");
  test.setTimeout(180_000);
  const harness = await launchSourceE2eHarness(28, installedRoot);
  try {
    const { page, application } = harness;
    await expect(page.getByRole("button", { name: /Open workspace/ })).toBeEnabled();
    const startupMs = performance.now() - harness.launchStarted;
    expect(await mapDecoderPids(application)).toEqual([]);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    expect(await mapDecoderPids(application)).toEqual([]);
    const cold = performance.now();
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    await expect.poll(async () => (await mapDecoderPids(application)).length).toBe(1);
    const away = performance.now();
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency", exact: true })).toBeVisible();
    const unrelatedTabMs = performance.now() - away;
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    const names = [
      "Headman Manor",
      "McJannek Station",
      "Museum of Human Art",
      "Sunstone Valley Resort",
      "Swiftbroom Academy",
    ];
    for (const name of names)
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const frames = page.locator('[data-testid^="map-artwork-"][data-icon-source]');
    await expect(frames).toHaveCount(5);
    await expect
      .poll(
        () =>
          frames.evaluateAll((nodes) =>
            nodes.every((node) => node.getAttribute("aria-busy") === "false"),
          ),
        { timeout: 90_000 },
      )
      .toBe(true);
    const coldMs = performance.now() - cold;
    const images = await frames.locator("img").evaluateAll((nodes) =>
      nodes.map((node) => {
        if (!(node instanceof HTMLImageElement)) throw new Error("Expected a preview image.");
        return {
          width: node.naturalWidth,
          height: node.naturalHeight,
          url: node.src,
          alt: node.alt,
        };
      }),
    );
    expect(images).toHaveLength(5);
    for (const image of images) {
      expect(image.width).toBeGreaterThan(0);
      expect(image.width).toBeLessThanOrEqual(1024);
      expect(image.height).toBeGreaterThan(0);
      expect(image.alt).toBe("");
      expect(image.url).toMatch(/^repoditor-icon:\/\/local\/[a-f0-9-]+$/);
    }
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: "test-results/maps-installed-minimum.png", fullPage: true });
    await page.getByRole("tab", { name: "Run", exact: true }).click();
    const warm = performance.now();
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    await expect(page.locator('[data-testid^="map-artwork-"][aria-busy="true"]')).toHaveCount(0);
    await expect(frames.locator("img")).toHaveCount(5);
    console.info(
      `Installed map preview timings (ms): cold=${coldMs.toFixed(0)}, warm=${(performance.now() - warm).toFixed(0)}`,
    );
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 900),
    );
    await page.screenshot({ path: "test-results/maps-installed-wide.png", fullPage: true });
    const profile = await application.evaluate(({ app }) => app.getPath("userData"));
    const manifest = path.join(profile, "presentation/maps/manifest.json");
    const before = await lstat(manifest, { bigint: true });
    const restart = performance.now();
    await harness.relaunch();
    const reopened = harness.page;
    await reopened.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(reopened);
    const restartReadyMs = performance.now() - restart;
    expect(await mapDecoderPids(harness.application)).toEqual([]);
    const disk = performance.now();
    await reopened.getByRole("tab", { name: "Maps", exact: true }).click();
    const reloaded = reopened.locator('[data-testid^="map-artwork-"][data-icon-source]');
    await expect(reloaded).toHaveCount(5);
    await expect
      .poll(() =>
        reloaded.evaluateAll((nodes) =>
          nodes.every((node) => node.getAttribute("aria-busy") === "false"),
        ),
      )
      .toBe(true);
    await expect(reloaded.locator("img")).toHaveCount(5);
    expect(await mapDecoderPids(harness.application)).toEqual([]);
    expect((await lstat(manifest, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
    console.info(
      `Map responsiveness (ms): startup=${startupMs.toFixed(0)}, unrelated-tab-during-cold=${unrelatedTabMs.toFixed(0)}, relaunch-workspace=${restartReadyMs.toFixed(0)}, disk-preview=${(performance.now() - disk).toFixed(0)}`,
    );
  } finally {
    await harness.dispose();
  }
});

test("closing during cold map preparation terminates its Python child", async () => {
  // Game assets stay outside fixtures; this lifecycle check requires the explicit read-only install.
  test.skip(!installedRoot, "Set REPODITOR_MAPS_GAME_ROOT to the verified read-only installation.");
  const harness = await launchSourceE2eHarness(28, installedRoot);
  try {
    const page = harness.page;
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    await expect.poll(async () => (await mapDecoderPids(harness.application)).length).toBe(1);
    const pids = await mapDecoderPids(harness.application);
    expect(pids).toHaveLength(1);
    await harness.dispose();
    await expect
      .poll(() =>
        pids.every((pid) => {
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
  } finally {
    await harness.dispose();
  }
});
