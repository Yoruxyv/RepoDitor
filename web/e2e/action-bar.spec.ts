import { expect, test } from "@playwright/test";
import { encryptEs3 } from "../src/features/save-file/es3";
import { loadBulkCosmeticFixture, loadSave } from "./fixtures";

test.beforeEach(async ({ page }) => page.goto("/"));

test("an unmodified save remains downloadable and re-imports without pending changes", async ({
  page,
}, testInfo) => {
  await loadSave(page, "run");
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await expect(page.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download verified copy" }).click();
  const output = testInfo.outputPath("unchanged.es3");
  await (await download).saveAs(output);
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await page.locator('input[type="file"]').setInputFiles(output);
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await expect(page.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download verified copy" })).toBeEnabled();
});

test("status follows baseline comparison, discard and switching files", async ({ page }) => {
  await loadSave(page, "run");
  await page.getByRole("tab", { name: "Run", exact: true }).click();
  const currency = page.getByRole("spinbutton", { name: "Currency" });
  await currency.fill("13");
  await expect(page.getByTestId("pending-change-count")).toHaveText("1 pending change");
  await currency.fill("12");
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await expect(page.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await currency.fill("13");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(currency).toHaveValue("12");
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await currency.fill("13");
  await loadSave(page, "meta");
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await expect(page.getByRole("button", { name: "Discard changes" })).toBeDisabled();
});

test("Lock All can be discarded back to imported ownership", async ({ page }) => {
  await loadBulkCosmeticFixture(page);
  await page.getByRole("button", { name: "Lock All Cosmetics", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Lock 556 cosmetics" }).click();
  await expect(page.getByText("0 of 557 supported cosmetics unlocked")).toBeVisible();
  await expect(page.getByTestId("pending-change-count")).toHaveText("1 pending change");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByText("556 of 557 supported cosmetics unlocked")).toBeVisible();
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await expect(page.getByRole("button", { name: "Discard changes" })).toBeDisabled();
});

test("restoring ownership keeps history-only modifications pending until discarded", async ({
  page,
}, testInfo) => {
  const source = JSON.stringify({
    cosmeticHistory: { value: [547, 999] },
    cosmeticUnlocks: { value: [999] },
    cosmeticEquipped: { value: [] },
    cosmeticPresets: { value: [[]] },
  });
  const buffer = Buffer.from(await encryptEs3(new TextEncoder().encode(source)));
  await page
    .locator('input[type="file"]')
    .setInputFiles({ buffer, mimeType: "application/octet-stream", name: "MetaSave.es3" });
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await page.getByRole("button", { name: "Unlock Remaining Cosmetics" }).click();
  await page.getByRole("button", { name: "Lock All Cosmetics", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Lock 557 cosmetics" }).click();
  await expect(page.getByText("0 of 557 supported cosmetics unlocked")).toBeVisible();
  await expect(page.getByTestId("pending-change-count")).toHaveText("1 pending change");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByTestId("pending-changes-review")).toContainText("Cosmetic history");
  await expect(page.getByTestId("pending-changes-review")).toContainText(
    "Original history → Updated history",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download verified copy" }).click();
  const output = testInfo.outputPath("history-changed.es3");
  await (await download).saveAs(output);
  await expect(page.getByTestId("pending-change-count")).toHaveText("1 pending change");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await page.locator('input[type="file"]').setInputFiles(output);
  await expect(page.getByTestId("pending-change-count")).toHaveText("No pending changes");
  await expect(page.getByText("0 of 557 supported cosmetics unlocked")).toBeVisible();
});

test("action bar fits desktop, tablet and narrow mobile in all supported locales", async ({
  page,
}, testInfo) => {
  await loadSave(page, "run");
  await page.getByRole("tab", { name: "Run", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Currency" }).fill("13");
  const bar = page.getByTestId("save-workspace").locator("footer");
  for (const language of ["English", "Bahasa Indonesia", "日本語", "한국어", "简体中文"]) {
    await page.getByTestId("language-menu-trigger").click();
    await page.getByRole("option", { name: language }).click();
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await bar.scrollIntoViewIfNeeded();
      const buttons = bar.getByRole("button");
      await expect(buttons).toHaveCount(3);
      for (const button of await buttons.all()) {
        await expect(button).toBeInViewport();
        const box = await button.boundingBox();
        if (!box) throw new Error("Action must have visible geometry");
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (language === "English")
        await page.screenshot({ path: testInfo.outputPath(`action-bar-${width}.png`) });
    }
  }
});
