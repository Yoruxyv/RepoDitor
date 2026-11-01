import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";
import { encryptEs3 } from "../src/features/save-file/es3";

export async function saveFixture(name: "meta" | "run") {
  const encoded = await readFile(
    resolve(import.meta.dirname, "fixtures", `${name}.es3.b64`),
    "utf8",
  );
  return Buffer.from(encoded.trim(), "base64");
}

export async function loadSave(page: Page, name: "meta" | "run") {
  await page.locator('input[type="file"]').setInputFiles({
    buffer: await saveFixture(name),
    mimeType: "application/octet-stream",
    name: name === "run" ? "REPO_SAVE.es3" : "MetaSave.es3",
  });
  await expect(page.getByTestId("save-workspace")).toBeVisible();
}

export async function loadBulkCosmeticFixture(
  page: Page,
  references: "none" | "equipped" | "preset" = "none",
) {
  const owned = [...Array.from({ length: 556 }, (_, index) => index + 1), 999];
  const source = JSON.stringify({
    cosmeticHistory: { value: owned },
    cosmeticUnlocks: { value: owned },
    cosmeticEquipped: { value: references === "equipped" ? [27] : [] },
    cosmeticPresets: { value: references === "preset" ? [[27]] : [[]] },
    colorPresets: { value: [[1, 2]] },
    future: { sentinel: "preserve" },
  });
  const buffer = Buffer.from(await encryptEs3(new TextEncoder().encode(source)));
  await page
    .locator('input[type="file"]')
    .setInputFiles({ buffer, mimeType: "application/octet-stream", name: "MetaSave.es3" });
  await expect(page.getByTestId("save-workspace")).toBeVisible();
}
