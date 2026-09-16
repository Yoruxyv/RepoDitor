import { expect, test } from "@playwright/test";

import { loadSave, saveFixture } from "./fixtures";

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
  await expect(page.getByText("Clean")).toBeVisible();
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
