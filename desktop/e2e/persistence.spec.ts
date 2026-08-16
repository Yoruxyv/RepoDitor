import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { REPO_ROOT, getPythonExecutable } from "./support/fixtureEnvironment";
import { launchSourceE2eHarness, type SourceE2eHarness } from "./support/harness";
import {
  waitForDiscoveredSave,
  waitForSafeSave,
  waitForStaleSave,
  waitForWorkspaceOrContinue,
} from "./support/waits";

function replaceFixtureCurrency(savePath: string, currency: number): void {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import sys; from pathlib import Path; from repo_save_editor.core.crypto import decrypt_save,encrypt_save; from repo_save_editor.services.run import set_run_stat; p=Path(sys.argv[1]); d=decrypt_save(p.read_bytes()); set_run_stat(d,'currency',int(sys.argv[2])); p.write_bytes(encrypt_save(d))",
      savePath,
      String(currency),
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: path.join(REPO_ROOT, "python") },
      stdio: "inherit",
    },
  );
}

function replaceMetaTokens(metaPath: string, token: number): void {
  execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import sys; from pathlib import Path; from repo_save_editor.core.crypto import decrypt_save,encrypt_save; p=Path(sys.argv[1]); d=decrypt_save(p.read_bytes()); d['cosmeticTokens']['value']=[int(sys.argv[2])]; p.write_bytes(encrypt_save(d))",
      metaPath,
      String(token),
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: path.join(REPO_ROOT, "python") },
      stdio: "inherit",
    },
  );
}

test("preserves safe writes, exact backups, and stale-save rejection", async () => {
  let harness: SourceE2eHarness | undefined;

  try {
    harness = await launchSourceE2eHarness();
    const { page, savePath, metaPath, sourceBefore, metaBefore } = harness;

    await waitForDiscoveredSave(page);
    await page.getByRole("button", { name: "Cosmetics" }).click();
    await page.getByRole("button", { name: "Lock All Cosmetics", exact: true }).click();
    await page.getByRole("button", { name: "Save Changes" }).click();
    await waitForSafeSave(page, "cosmetics");
    const metaBackups = (await readdir(path.dirname(metaPath))).filter((name) =>
      name.startsWith(`${path.basename(metaPath)}.bak-`),
    );
    expect(metaBackups).toHaveLength(1);
    expect(
      (await readFile(path.join(path.dirname(metaPath), metaBackups[0]!))).equals(metaBefore),
    ).toBe(true);
    expect((await readFile(metaPath)).equals(metaBefore)).toBe(false);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(true);

    await page.getByRole("button", { name: "Run Saves" }).click();
    await waitForDiscoveredSave(page);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);

    await page.getByRole("tab", { name: "Players" }).click();
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("0");
    await page.getByRole("button", { name: "Heal to Full" }).click();
    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("0");
    await page.getByRole("spinbutton", { name: "Strength for Beta" }).fill("3");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("12");
    await page.getByRole("spinbutton", { name: "Currency" }).fill("20");
    await page.getByRole("tab", { name: "Items" }).click();
    await page.getByRole("button", { name: "Recharge Melee Inflatable Hammer, tool 1" }).click();
    const saveStarted = performance.now();
    await page.getByRole("button", { name: "Save Changes" }).click();

    await waitForSafeSave(page, "workspace");
    await expect(page.getByText(/\.bak-\d+$/)).toHaveCount(0);
    const saveReadyMs = performance.now() - saveStarted;
    const backups = (await readdir(path.dirname(savePath))).filter((name) =>
      name.startsWith(`${path.basename(savePath)}.bak-`),
    );
    expect(backups).toHaveLength(1);
    expect(
      (await readFile(path.join(path.dirname(savePath), backups[0]!))).equals(sourceBefore),
    ).toBe(true);
    expect((await readFile(savePath)).equals(sourceBefore)).toBe(false);

    await page.getByRole("button", { name: "Change save" }).click();
    await waitForDiscoveredSave(page);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);

    await page.getByRole("tab", { name: "Players" }).click();
    await page.getByRole("button", { name: /Beta/ }).click();
    await expect(page.getByRole("spinbutton", { name: "Current health" })).toHaveValue("100");
    await page.getByRole("tab", { name: "Upgrades" }).click();
    await expect(page.getByRole("spinbutton", { name: "Strength for Beta" })).toHaveValue("3");
    await page.getByRole("tab", { name: "Run" }).click();
    await expect(page.getByRole("spinbutton", { name: "Currency" })).toHaveValue("20");
    await page.getByRole("tab", { name: "Items" }).click();
    await expect(
      page.getByRole("heading", { name: "Melee Inflatable Hammer", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Recharge appears only for tools RepoDitor can safely refill."),
    ).toBeVisible();
    const refilledHammer = page.getByTestId("item-instance-Item Melee Inflatable Hammer/1");
    await expect(refilledHammer.getByText("Full")).toBeVisible();
    await expect(page.getByRole("button", { name: /Recharge .*tool/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Recharge All Tools" })).toBeDisabled();
    await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("No pending changes");

    await page.getByRole("button", { name: "Cosmetics" }).click();
    await page.getByRole("button", { name: "Unlock All Cosmetics", exact: true }).click();
    replaceMetaTokens(metaPath, 8);
    const externalMetaBytes = await readFile(metaPath);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await waitForStaleSave(page, "cosmetics");
    expect((await readFile(metaPath)).equals(externalMetaBytes)).toBe(true);
    expect(
      (await readdir(path.dirname(metaPath))).filter((name) =>
        name.startsWith(`${path.basename(metaPath)}.bak-`),
      ),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "Revert all" }).click();

    await page.getByRole("button", { name: "Run Saves" }).click();
    await page.getByRole("tab", { name: "Run" }).click();
    await page.getByRole("spinbutton", { name: "Currency" }).fill("30");
    replaceFixtureCurrency(savePath, 777);
    const externalBytes = await readFile(savePath);
    await page.getByRole("button", { name: "Save Changes" }).click();
    await waitForStaleSave(page, "workspace");
    expect((await readFile(savePath)).equals(externalBytes)).toBe(true);
    expect(
      (await readdir(path.dirname(savePath))).filter((name) =>
        name.startsWith(`${path.basename(savePath)}.bak-`),
      ),
    ).toHaveLength(1);

    console.info(`Persistence save timing (ms): save=${saveReadyMs.toFixed(0)}`);
  } finally {
    await harness?.dispose();
  }
});
