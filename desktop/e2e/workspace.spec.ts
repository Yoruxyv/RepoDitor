import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";

import { EXPECTED_DESKTOP_VERSION } from "./support/fixtureEnvironment";
import { launchSourceE2eHarness, type SourceE2eHarness } from "./support/harness";
import {
  waitForDiscoveredSave,
  waitForSafeSave,
  waitForWorkspaceOrContinue,
} from "./support/waits";

const expectedVersion = EXPECTED_DESKTOP_VERSION;

async function imageNaturalWidth(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error("Expected locator to resolve to an HTMLImageElement.");
    }

    return element.naturalWidth;
  });
}

async function setWindowSize(
  application: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const window = await application.browserWindow(page);
  await window.evaluate((browserWindow, size) => browserWindow.setSize(size.width, size.height), {
    width,
    height,
  });
  await expect
    .poll(async () => {
      const [actualWidth, actualHeight] = await window.evaluate((browserWindow) =>
        browserWindow.getSize(),
      );
      return (
        actualWidth >= width &&
        actualWidth <= width + 16 &&
        actualHeight >= height &&
        actualHeight <= height + 16
      );
    })
    .toBe(true);
}

async function layout(page: Page) {
  return page.evaluate(() => ({
    hasHorizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
}

async function selectCustomOption(page: Page, label: string, value: string): Promise<void> {
  const control = page.getByRole("combobox", { name: label });
  if ((await control.getAttribute("aria-expanded")) !== "true") {
    await control.click();
  }
  await page.locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
}

test("covers the source workspace, shell, and editor domains", async () => {
  let harness: SourceE2eHarness | undefined;

  try {
    harness = await launchSourceE2eHarness();
    const { application, page, savePath, gameRoot, sourceBefore, launchStarted } = harness;

    const chrome = await application.evaluate(({ app, Menu }) => ({
      hasApplicationMenu: Menu.getApplicationMenu() !== null,
      version: app.getVersion(),
    }));
    expect(chrome.version).toBe(expectedVersion);
    expect(chrome.hasApplicationMenu).toBe(false);
    await page.bringToFront();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Alt");
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu() !== null)).toBe(
      false,
    );
    await expect(page).toHaveTitle("RepoDitor");
    const appIcon = page.locator('header img[src$="icon.png"]');
    await expect(appIcon).toHaveJSProperty("complete", true);
    expect(
      await appIcon.evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    await expect(page.getByLabel("About RepoDitor")).toContainText(`RepoDitor v${expectedVersion}`);
    await expect(page.getByRole("link", { name: "Project source" })).toHaveAttribute(
      "href",
      "https://github.com/Yoruxyv/RepoDitor",
    );
    await expect(page.getByTestId("github-stars")).toHaveText("321");
    await expect(page.getByRole("button", { name: "Theme: System" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Language: English" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Language" })).toHaveCount(0);
    await page.getByRole("button", { name: "Theme: System" }).click();
    await page.getByRole("option", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Theme: Light" }).click();
    await page.getByRole("option", { name: "System" }).click();
    await expect(page.getByRole("button", { name: "Theme: System" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);
    await page.getByRole("button", { name: "Theme: System" }).click();
    await page.getByRole("option", { name: "Light" }).click();

    await setWindowSize(application, page, 960, 640);
    await expect(page.getByTestId("github-project-link")).toBeVisible();
    await expect(page.getByTestId("github-stars")).not.toBeVisible();
    for (const check of [
      {
        trigger: "Language: English",
        option: "日本語",
        run: "ランセーブ",
        theme: "テーマ",
        refresh: "更新",
      },
      {
        trigger: "言語: 日本語",
        option: "한국어",
        run: "런 세이브",
        theme: "테마",
        refresh: "새로 고침",
      },
      { trigger: "언어: 한국어", option: "中文", run: "游戏存档", theme: "主题", refresh: "刷新" },
      {
        trigger: "语言: 中文",
        option: "Bahasa Indonesia",
        run: "Save Run",
        theme: "Tema",
        refresh: "Segarkan",
      },
      {
        trigger: "Bahasa: Bahasa Indonesia",
        option: "English",
        run: "Run Saves",
        theme: "Theme",
        refresh: "Refresh",
      },
    ]) {
      await page.getByRole("button", { name: check.trigger }).click();
      await page.getByRole("option", { name: check.option }).click();
      await expect(page.getByRole("button", { name: check.run })).toBeVisible();
      await expect(
        page.getByRole("button", { name: new RegExp(`^${check.theme}:`) }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: check.refresh })).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    }
    await setWindowSize(application, page, 1200, 800);

    await waitForDiscoveredSave(page);
    await expect(page.locator("details")).toHaveCount(0);
    await expect(page.getByText(savePath, { exact: true })).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const launchReadyMs = performance.now() - launchStarted;
    await page.getByRole("button", { name: "Refresh" }).hover();
    const reducedFeedback = await page
      .getByRole("button", { name: "Refresh" })
      .evaluate((button) => ({
        transform: getComputedStyle(button).transform,
        transitionDuration: getComputedStyle(button).transitionDuration,
      }));
    expect(
      Number.parseFloat(reducedFeedback.transitionDuration) /
        (reducedFeedback.transitionDuration.endsWith("ms") ? 1_000 : 1),
    ).toBeLessThanOrEqual(0.000_01);
    expect(reducedFeedback.transform).toBe("none");
    const boundary = await page.evaluate(() => ({
      project: Object.keys(window.repoditor.project),
      environment: Object.keys(window.repoditor.environment).sort((left, right) =>
        left.localeCompare(right),
      ),
      game: Object.keys(window.repoditor.game),
      players: Object.keys(window.repoditor.players).sort((left, right) =>
        left.localeCompare(right),
      ),
      upgrades: Object.keys(window.repoditor.upgrades),
      run: Object.keys(window.repoditor.run),
      advanced: Object.keys(window.repoditor.advanced),
      cosmetics: Object.keys(window.repoditor.cosmetics).sort((left, right) =>
        left.localeCompare(right),
      ),
      maps: Object.keys(window.repoditor.maps),
      requireType: typeof window.require,
      saves: Object.keys(window.repoditor.saves).sort((left, right) => left.localeCompare(right)),
    }));
    expect(boundary).toEqual({
      project: ["metadata"],
      environment: ["detect"],
      game: ["status"],
      players: ["avatar", "list"],
      upgrades: ["list", "prepareEntry"],
      run: ["get"],
      advanced: ["get"],
      cosmetics: ["get", "write"],
      maps: ["list"],
      requireType: "undefined",
      saves: ["list", "open", "write"],
    });

    await page.getByRole("button", { name: "Cosmetics" }).click();
    await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
    await expect(page.getByText("MetaSave.es3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Run Saves" }).click();

    const openStarted = performance.now();
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    const openReadyMs = performance.now() - openStarted;
    await expect(page.getByRole("heading", { name: "2026-08-08 10:20:30" })).toBeVisible();
    await expect(page.getByText("Validated locally")).toBeVisible();
    const selectedMetadata = page.getByTestId("selected-save-metadata");
    const selectedSavePath = page.getByTestId("selected-save-path");
    await expect(page.locator("details")).toHaveCount(1);
    await expect(selectedSavePath).toContainText(path.basename(savePath));
    await expect(selectedSavePath.locator("code")).not.toBeVisible();
    const metadataBeforeExpand = await selectedMetadata.boundingBox();
    await selectedSavePath.locator("summary").click();
    await expect(selectedSavePath.locator("code")).toHaveText(savePath);
    const metadataAfterExpand = await selectedMetadata.boundingBox();
    expect(metadataAfterExpand?.x).toBe(metadataBeforeExpand?.x);
    expect(metadataAfterExpand?.y).toBe(metadataBeforeExpand?.y);
    await selectedSavePath.getByRole("button", { name: "Copy Source" }).click();
    await expect(selectedSavePath.getByText("Path copied")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Edit this save" })).toBeVisible();
    await expect(page.getByText("Normal")).toBeVisible();

    await page.getByRole("tab", { name: "Items" }).click();
    await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
    const hammerIcon = page.getByTestId("item-icon-Item Melee Inflatable Hammer/1");
    await expect(hammerIcon.locator("img")).toBeVisible();
    await expect.poll(() => imageNaturalWidth(hammerIcon.locator("img"))).toBeGreaterThan(0);
    await expect(page.getByTestId("item-icon-Item Cart Medium/1")).not.toHaveAttribute(
      "data-icon-source",
      "local",
    );
    await expect(page.getByTestId("item-icon-Item WalkieTalkieBox/1")).not.toHaveAttribute(
      "data-icon-source",
      "local",
    );
    const iconBoundary = await page.evaluate(async () => {
      const [advancedResult, cosmeticsResult] = await Promise.all([
        window.repoditor.advanced.get("REPO_SAVE_2026_08_08_10_20_30"),
        window.repoditor.cosmetics.get(),
      ]);
      return JSON.stringify({ advancedResult, cosmeticsResult });
    });
    expect(iconBoundary).toContain("iconToken");
    expect(iconBoundary).not.toMatch(/iconKey|AppData|LocalLow|\.png/);
    await expect(
      page.getByText("Recharge appears only for tools RepoDitor can safely refill."),
    ).toBeVisible();
    const cartGroup = page.getByTestId("item-group-Cart Medium");
    await expect(cartGroup.getByLabel("2 items")).toBeVisible();
    await expect(cartGroup.getByText(/^#\d+$/)).toHaveCount(0);
    await expect(cartGroup.getByText(/Charge|Full/)).toHaveCount(0);
    const healthPackGroup = page.getByTestId("item-group-Health Pack Medium");
    await expect(healthPackGroup.getByText(/Charge|Full/)).toHaveCount(0);
    const itemSearch = page.getByRole("searchbox", { name: "Search items" });
    await itemSearch.fill("  CART MEDIUM  ");
    await expect(page.getByText("2 matching items")).toBeVisible();
    await expect(page.getByTestId("item-group-Melee Inflatable Hammer")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear item search" }).click();
    await selectCustomOption(page, "Filter", "rechargeable");
    await expect(page.getByTestId("item-group-Melee Inflatable Hammer")).toBeVisible();
    await expect(page.getByTestId("item-group-Cart Medium")).toHaveCount(0);
    await selectCustomOption(page, "Filter", "not_rechargeable");
    await expect(page.getByTestId("item-group-Cart Medium")).toBeVisible();
    await expect(page.getByTestId("item-group-Health Pack Medium")).toBeVisible();
    await expect(page.getByTestId("item-group-Melee Inflatable Hammer")).toHaveCount(0);
    await selectCustomOption(page, "Filter", "upgrades");
    await expect(page.getByTestId("item-group-Upgrade Player Health")).toBeVisible();
    await expect(page.getByTestId("item-group-Cart Medium")).toHaveCount(0);
    await selectCustomOption(page, "Filter", "all");
    await selectCustomOption(page, "Sort", "quantity-desc");
    await expect(
      page.getByRole("list", { name: "Item instances" }).locator(":scope > li").first(),
    ).toHaveAttribute("data-testid", "item-group-Cart Medium");

    const hammer = page.getByTestId("item-instance-Item Melee Inflatable Hammer/1");
    await expect(page.getByTestId("item-icon-Item Melee Inflatable Hammer/1")).toHaveAttribute(
      "data-icon-source",
      "local",
    );
    await expect(hammer.getByText("Current charge: 99")).toBeVisible();
    await expect(page.getByText("Item Melee Inflatable Hammer/1", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Recharge All Tools" }).click();
    await expect(hammer.getByText("Pending: 99 → Full")).toBeVisible();
    await expect(page.getByRole("button", { name: "Recharge All Tools" })).toBeDisabled();
    await itemSearch.fill("cart");
    await expect(page.getByText(/1 pending item hidden by filter/)).toBeVisible();
    await page.getByRole("button", { name: "Clear item search" }).click();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("1 pending change");
    await expect(page.locator("#workspace-tab-pending-4")).toContainText("1 pending change");
    await expect(page.locator("#run-saves-pending")).toContainText("1 pending change");
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);

    await page.getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Players" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByTestId("avatar-fallback")).toHaveText("B");
    const health = page.getByRole("spinbutton", { name: "Current health" });
    await health.focus();
    expect(await health.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      "solid",
    );
    await expect(page.getByLabel("Maximum health 100")).toBeVisible();
    await page.getByRole("button", { name: "Heal to Full" }).click();
    await expect(health).toHaveValue("100");
    await expect(page.getByRole("button", { name: "Heal to Full" })).toBeDisabled();
    await expect(page.getByTestId("pending-health-edit")).toContainText("0 → 100");
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("2 pending changes");

    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByRole("tab", { name: "Players" }).click();
    await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");

    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByTestId("upgrades-avatar-fallback")).toHaveText("B");
    await expect(page.getByTestId("selected-player-identity")).toContainText("Beta");
    await expect(page.getByTestId("selected-player-identity")).toContainText("222");
    await expect(page.getByTestId("upgrade-icon-playerUpgradeStrength")).toHaveAttribute(
      "data-icon-source",
      "specific",
    );
    await expect(page.getByText("playerUpgradeStrength", { exact: true })).toHaveCount(0);
    const strength = page.getByRole("spinbutton", { name: "Strength for Beta" });
    await strength.fill("3");
    await expect(page.getByTestId("pending-upgrade-playerUpgradeStrength")).toContainText("0 → 3");

    await page.getByRole("tab", { name: "Run" }).click();
    const currency = page.getByRole("spinbutton", { name: "Currency" });
    await currency.fill("20");
    await expect(page.getByTestId("pending-run-currency")).toContainText("12 → 20");

    await page.getByRole("tab", { name: "Maps" }).click();
    await expect(page.getByText("McJannek Station")).toBeVisible();
    await expect(page.getByText("Headman Manor")).toBeVisible();
    await expect(page.getByText("Modded Moon")).toBeVisible();
    await expect(page.getByText("Arctic", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(path.join(gameRoot, "REPO_Data", "StreamingAssets", "aa", "catalog.json"), {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("details")).toHaveCount(1);

    await setWindowSize(application, page, 960, 640);
    const reviewScrollPosition = await page.evaluate(() => window.scrollY);
    const reviewButton = page.getByRole("button", { name: "Review" });
    const reviewColors = () =>
      reviewButton.evaluate((button) => ({
        border: getComputedStyle(button).borderColor,
        text: getComputedStyle(button).color,
      }));
    const restingReviewColors = await reviewColors();
    await reviewButton.hover();
    await expect.poll(reviewColors).not.toEqual(restingReviewColors);
    const hoveredReviewColors = await reviewColors();
    await reviewButton.click();
    await page.mouse.move(0, 0);
    await expect(reviewButton).toHaveAttribute("aria-expanded", "true");
    await expect.poll(reviewColors).toEqual(hoveredReviewColors);
    const review = page.getByTestId("workspace-review");
    await expect(review).toBeVisible();
    expect(
      await page
        .getByTestId("workspace-action-bar")
        .evaluate(
          (actionBar, reviewId) => actionBar.contains(document.getElementById(reviewId)),
          "workspace-review",
        ),
    ).toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBe(reviewScrollPosition);
    expect(await review.evaluate((element) => getComputedStyle(element).overflowY)).not.toMatch(
      /auto|scroll/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
      ),
    ).toBe(true);
    expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    await expect(page.getByText("Beta · Health")).toBeVisible();
    await expect(page.getByText("Beta · Strength")).toBeVisible();
    await expect(page.getByText("Run · Currency")).toBeVisible();
    await expect(page.getByText("Melee Inflatable Hammer · Charge")).toBeVisible();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("4 pending changes");
    await page.getByRole("button", { name: "Revert all" }).click();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("No pending changes");

    // Recreate the persisted state used by the original responsive checks without
    // asserting persistence behavior here; persistence owns those assertions.
    await page.getByRole("tab", { name: "Players" }).click();
    await page.getByRole("button", { name: /Beta/ }).click();
    await page.getByRole("button", { name: "Heal to Full" }).click();
    await page.getByRole("tab", { name: "Upgrades" }).click();
    await page.getByRole("spinbutton", { name: "Strength for Beta" }).fill("3");
    await page.getByRole("tab", { name: "Run" }).click();
    await page.getByRole("spinbutton", { name: "Currency" }).fill("20");
    await page.getByRole("tab", { name: "Items" }).click();
    await page.getByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1" }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await waitForSafeSave(page, "workspace");
    await page.getByRole("button", { name: "Change save" }).click();
    await waitForDiscoveredSave(page);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    await page.getByRole("tab", { name: "Players" }).click();
    await page.getByRole("button", { name: /Beta/ }).click();

    for (const size of [
      { width: 1600, height: 900 },
      { width: 1200, height: 800 },
      { width: 960, height: 640 },
    ]) {
      await setWindowSize(application, page, size.width, size.height);
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await expect(page.getByRole("tab", { name: "Maps" })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("tab", { name: "Overview" }).click();
      await expect(page.getByText("Validated locally")).toBeVisible();
      await expect(page.getByText("Normal")).toBeVisible();
      await page.getByRole("tab", { name: "Players" }).click();
      await expect(page.getByRole("button", { name: /Alpha/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Beta" })).toBeVisible();
      await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");
      await page.getByRole("tab", { name: "Upgrades" }).click();
      await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("3");
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByRole("tab", { name: "Run" }).click();
      await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("20");
      await page.getByRole("tab", { name: "Items" }).click();
      await expect(
        page.getByRole("heading", { name: "Melee Inflatable Hammer", exact: true }),
      ).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByRole("button", { name: "Cosmetics" }).click();
      await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
      await page.getByRole("button", { name: "Run Saves" }).click();
      await page.getByRole("tab", { name: "Maps" }).click();
      await expect(page.getByText("McJannek Station")).toBeVisible();
      expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    }

    await setWindowSize(application, page, 960, 640);
    await page.getByRole("tab", { name: "Run" }).click();
    const minimumCurrency = page.getByRole("spinbutton", { name: "Currency" });
    await minimumCurrency.fill("21");
    await page.getByTestId("workspace-action-bar").waitFor({ state: "visible" });
    await minimumCurrency.blur();
    await minimumCurrency.focus();
    const focusClearOfSurface = await minimumCurrency.evaluate((control) => {
      const surface = document.querySelector<HTMLElement>("[data-pending-surface-active='true']");
      if (!surface) return false;
      return control.getBoundingClientRect().bottom <= surface.getBoundingClientRect().top;
    });
    expect(focusClearOfSurface).toBe(true);
    expect((await layout(page)).hasHorizontalOverflow).toBe(false);
    await page.getByRole("button", { name: "Revert all" }).click();

    console.info(
      `Workspace timings (ms): launch=${launchReadyMs.toFixed(0)}, open=${openReadyMs.toFixed(0)}`,
    );
  } finally {
    await harness?.dispose();
  }
});
