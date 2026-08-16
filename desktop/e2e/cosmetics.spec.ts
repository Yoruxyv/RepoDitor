import { readFile } from "node:fs/promises";

import { expect, test, type Locator } from "@playwright/test";

import { launchSourceE2eHarness, type SourceE2eHarness } from "./support/harness";
import { waitForDiscoveredSave } from "./support/waits";

async function imageNaturalWidth(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error("Expected locator to resolve to an HTMLImageElement.");
    }

    return element.naturalWidth;
  });
}

test("covers cosmetic catalog and pending-edit behavior", async () => {
  let harness: SourceE2eHarness | undefined;

  try {
    harness = await launchSourceE2eHarness();
    const { page, savePath, metaPath, sourceBefore, metaBefore } = harness;

    await waitForDiscoveredSave(page);
    await page.getByRole("button", { name: "Cosmetics" }).click();

    await expect(page.getByRole("heading", { name: "Cosmetics" })).toBeVisible();
    await expect(page.getByText("Known catalog")).toBeVisible();
    await expect(page.getByText("Saved presets")).toBeVisible();
    await expect(page.getByLabel("Search by cosmetic ID")).toHaveCount(0);
    await expect(page.getByText("Cosmetic #27")).toHaveCount(0);
    const cosmeticIcon = page.getByTestId("cosmetic-icon-27");
    await expect(cosmeticIcon.locator("img")).toHaveAttribute("loading", "lazy");
    expect(await imageNaturalWidth(cosmeticIcon.locator("img"))).toBe(0);
    await cosmeticIcon.scrollIntoViewIfNeeded();
    await expect(cosmeticIcon.locator("img")).toBeVisible();
    await expect.poll(() => imageNaturalWidth(cosmeticIcon.locator("img"))).toBeGreaterThan(0);
    await expect(cosmeticIcon.locator("img")).not.toHaveAttribute("src", /AppData|LocalLow|\.png/i);
    await cosmeticIcon.locator("img").evaluate((image) => {
      image.dataset.loadedBeforeFilter = "true";
    });
    await page.getByRole("combobox", { name: "Type" }).selectOption("0");
    await expect(cosmeticIcon).toBeHidden();
    await page.getByRole("combobox", { name: "Type" }).selectOption("all");
    await page.getByRole("searchbox", { name: "Search cosmetics" }).fill("missing cosmetic");
    await expect(cosmeticIcon).toBeHidden();
    await page.getByRole("searchbox", { name: "Search cosmetics" }).fill("");
    await page.getByRole("combobox", { name: "Ownership" }).selectOption("locked");
    await expect(cosmeticIcon).toBeHidden();
    await page.getByRole("combobox", { name: "Ownership" }).selectOption("all");
    await page.getByRole("combobox", { name: "Sort" }).selectOption("id-desc");
    await expect(cosmeticIcon.locator("img")).toHaveAttribute("data-loaded-before-filter", "true");
    await expect(page.getByTestId("cosmetic-icon-27-loading")).toHaveCount(0);
    await expect(page.getByTestId("cosmetic-icon-26")).toHaveAttribute(
      "data-icon-source",
      "fallback",
    );
    await expect(page.getByRole("button", { name: "Clear All Presets" })).toBeDisabled();
    await page.getByRole("button", { name: "Lock All Cosmetics", exact: true }).click();
    await expect(page.getByTestId("cosmetics-pending-edit-count")).toHaveText("1 pending change");
    await expect(page.locator("#cosmetics-pending")).toContainText("1 pending change");
    expect((await readFile(metaPath)).equals(metaBefore)).toBe(true);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);
    await page.getByRole("button", { name: "Run Saves" }).click();
    await page.getByRole("button", { name: "Cosmetics" }).click();
    await expect(cosmeticIcon.locator("img")).toHaveAttribute("data-loaded-before-filter", "true");
    await expect(page.getByTestId("cosmetic-icon-27-loading")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lock All pending" })).toBeDisabled();
    await page.getByRole("button", { name: "Revert all" }).click();
    await page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
    await expect(page.getByTestId("cosmetics-pending-edit-count")).toHaveText("1 pending change");
    await page.getByRole("button", { name: "Revert all" }).click();
  } finally {
    await harness?.dispose();
  }
});
