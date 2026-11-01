import { expect, test } from "@playwright/test";

import { loadSave, saveFixture, loadBulkCosmeticFixture } from "./fixtures";

test.beforeEach(async ({ page }) => page.goto("/"));

test("Run edit, recharge, review, export, and exported reload", async ({ page }, testInfo) => {
  await loadSave(page, "run");
  await page.getByRole("tab", { name: "Run" }).click();
  await page.getByRole("spinbutton", { name: "Currency" }).fill("13");
  await page.getByRole("tab", { name: "Recharge" }).click();
  await expect(page.getByText("1 item needs recharging")).toBeVisible();
  await page.getByRole("button", { name: "Recharge All Supported Items" }).click();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByTestId("pending-changes-review")).toContainText("Currency12 → 13");
  await expect(page.getByTestId("pending-changes-review")).toContainText(
    "All supported items fully charged",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download verified copy" }).click();
  const output = testInfo.outputPath("REPO_SAVE.repoditor.es3");
  await (await downloadPromise).saveAs(output);

  await page.locator('input[type="file"]').setInputFiles(output);
  await page.getByRole("tab", { name: "Run" }).click();
  await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("13");
  await page.getByRole("tab", { name: "Recharge" }).click();
  await expect(page.getByText("All supported items fully charged.")).toBeVisible();
});

test("MetaSave cosmetics edit, export, and no-op state", async ({ page }) => {
  await loadSave(page, "meta");
  await page.getByRole("button", { name: "Unlock Remaining Cosmetics" }).click();
  await expect(page.getByText("1 pending change")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download verified copy" }).click();
  await expect(await downloadPromise).toBeTruthy();
  await expect(page.getByRole("button", { name: "Unlock Remaining Cosmetics" })).toBeDisabled();
  await expect(page.getByText("All supported cosmetics are already unlocked.")).toBeVisible();
});

test("invalid input fails safely and changing files resets the session", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from("not an ES3 container"),
    mimeType: "application/octet-stream",
    name: "invalid.es3",
  });
  await expect(page.getByText("Save not loaded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download verified copy" })).toHaveCount(0);

  await loadSave(page, "run");
  await page.getByRole("tab", { name: "Run" }).click();
  await page.getByRole("spinbutton", { name: "Currency" }).fill("13");
  await expect(page.getByText("1 pending change")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    buffer: await saveFixture("meta"),
    mimeType: "application/octet-stream",
    name: "MetaSave.es3",
  });
  await expect(page.getByText("MetaSave", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No pending changes")).toBeVisible();
});

test("save session stays memory-only, makes no save request, and clears on refresh", async ({
  page,
}) => {
  const requests: { readonly method: string; readonly url: string }[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  await loadSave(page, "run");
  expect(
    requests.every(
      ({ method, url }) => method === "GET" && url.startsWith("http://127.0.0.1:4173/"),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(async () => ({
      indexedDb: (await indexedDB.databases()).length,
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ indexedDb: 0, local: 0, session: 0 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "R.E.P.O. Save Editor — directly in your browser." }),
  ).toBeVisible();
  await expect(page.getByTestId("save-workspace")).toHaveCount(0);
});

test("556/557 bulk locking confirms, cancels and survives encrypted export/re-import", async ({
  page,
}, testInfo) => {
  await loadBulkCosmeticFixture(page);
  await expect(page.getByText("556 of 557 supported cosmetics unlocked")).toBeVisible();
  await expect(page.getByLabel("Cosmetic ID")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove ownership", exact: true })).toHaveCount(0);
  const lock = page.getByRole("button", { name: "Lock All Cosmetics", exact: true });
  await expect(lock).toBeEnabled();
  await lock.click();
  let dialog = page.getByRole("dialog", { name: "Lock All Cosmetics?" });
  await expect(dialog).toContainText("556 supported cosmetics");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(lock).toBeFocused();
  await expect(page.getByText("556 of 557 supported cosmetics unlocked")).toBeVisible();
  await expect(page.getByText("No pending changes", { exact: true })).toBeVisible();
  await lock.click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("No pending changes", { exact: true })).toBeVisible();
  await lock.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Lock 556 cosmetics", exact: true })
    .click();
  await expect(page.getByText("0 of 557 supported cosmetics unlocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock Remaining Cosmetics" })).toBeFocused();
  await expect(page.getByText("1 unsupported owned cosmetic is preserved.")).toBeVisible();
  await expect(lock).toBeDisabled();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByTestId("pending-changes-review")).toContainText(
    "556 unlocked → 0 unlocked",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download verified copy" }).click();
  const output = testInfo.outputPath("bulk-locked.es3");
  await (await download).saveAs(output);
  await page.locator('input[type="file"]').setInputFiles(output);
  await expect(page.getByText("0 of 557 supported cosmetics unlocked")).toBeVisible();
  await expect(page.getByText("1 unsupported owned cosmetic is preserved.")).toBeVisible();
  await expect(page.getByText("No pending changes", { exact: true })).toBeVisible();
});

for (const references of ["equipped", "preset"] as const) {
  test(`556/557 Lock All explains ${references} restrictions without modifying ownership`, async ({
    page,
  }) => {
    await loadBulkCosmeticFixture(page, references);
    await expect(page.getByText("556 of 557 supported cosmetics unlocked")).toBeVisible();
    const lock = page.getByRole("button", { name: "Lock All Cosmetics", exact: true });
    await expect(lock).toBeDisabled();
    await expect(page.locator("#cosmetics-lock-reason")).toContainText(
      references === "equipped" ? "is equipped" : "saved preset",
    );
    await expect(page.locator("#cosmetics-lock-reason")).toContainText(
      "import the updated MetaSave",
    );
    await expect(page.getByText("No pending changes", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("bulk cosmetic controls and confirmation stay usable across viewport sizes", async ({
  page,
}, testInfo) => {
  await loadBulkCosmeticFixture(page);
  for (const width of [375, 900, 1440]) {
    await page.setViewportSize({ width, height: 812 });
    const lock = page.getByRole("button", { name: "Lock All Cosmetics", exact: true });
    await expect(lock).toBeInViewport();
    await expect(page.getByRole("button", { name: "Unlock Remaining Cosmetics" })).toBeInViewport();
    await lock.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Lock 556 cosmetics" })).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("Confirmation must have visible geometry");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`cosmetics-confirm-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(lock).toBeFocused();
    await expect(page.getByText("No pending changes", { exact: true })).toBeVisible();
  }
});
