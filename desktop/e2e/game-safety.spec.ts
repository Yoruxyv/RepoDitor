import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { E2E_SAVE_ID } from "./support/fixtureEnvironment";
import { launchSourceE2eHarness, type SourceE2eHarness } from "./support/harness";
import {
  waitForDiscoveredSave,
  waitForGameDialogClosed,
  waitForGameRunningDialog,
  waitForGameStatus,
  waitForWorkspaceOrContinue,
} from "./support/waits";

const saveId = E2E_SAVE_ID;

async function waitForChildSpawn(child: ChildProcess, label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      child.off("spawn", onSpawn);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error(`${label} failed to spawn.`, { cause: error }));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `${label} exited before spawn completed (code=${code ?? "null"}, signal=${signal ?? "none"}).`,
        ),
      );
    };

    child.once("spawn", onSpawn);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function terminateChildProcess(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  const close = once(child, "close", {
    signal: AbortSignal.timeout(5_000),
  });
  if (!child.kill()) {
    throw new Error(`${label} could not be terminated.`);
  }

  try {
    await close;
  } catch (error) {
    throw new Error(`${label} did not close within 5 seconds.`, { cause: error });
  }
}

test("blocks save writes while the R.E.P.O. process is running", async () => {
  let harness: SourceE2eHarness | undefined;
  let repoProcess: ChildProcess | undefined;

  try {
    harness = await launchSourceE2eHarness();
    const { page, savePath, metaPath, gameRoot } = harness;

    await waitForDiscoveredSave(page);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await waitForWorkspaceOrContinue(page);
    await page.getByRole("tab", { name: "Run" }).click();
    await page.getByRole("spinbutton", { name: "Currency" }).fill("13");

    if (process.platform === "win32") {
      const repoExecutable = path.join(gameRoot, "REPO.exe");
      repoProcess = spawn(repoExecutable, ["-e", "setInterval(() => {}, 1000)"], {
        cwd: gameRoot,
        stdio: "ignore",
        windowsHide: true,
      });
      await waitForChildSpawn(repoProcess, "synthetic REPO.exe");
      expect(repoProcess.exitCode).toBeNull();
      await waitForGameStatus(page, "running");

      await page.getByRole("button", { name: "Save Changes" }).focus();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await waitForGameRunningDialog(page);
      const checkAgain = page.getByRole("button", { name: "Check Again" });
      const exitRepoDitor = page.getByRole("button", { name: "Exit RepoDitor" });
      await expect(checkAgain).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(exitRepoDitor).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(checkAgain).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(checkAgain).toBeFocused();
      const dialogOffset = await page.getByRole("dialog").evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return {
          horizontal: Math.abs(
            bounds.left + bounds.width / 2 - document.documentElement.clientWidth / 2,
          ),
          vertical: Math.abs(
            bounds.top + bounds.height / 2 - document.documentElement.clientHeight / 2,
          ),
        };
      });
      expect(dialogOffset.horizontal).toBeLessThanOrEqual(1);
      expect(dialogOffset.vertical).toBeLessThanOrEqual(1);

      const runBeforeBlocked = await readFile(savePath);
      const runBackupsBefore = (await readdir(path.dirname(savePath))).filter((name) =>
        name.startsWith(`${path.basename(savePath)}.bak-`),
      ).length;
      const runBlocked = await page.evaluate(
        async ({ id }) => {
          const opened = await window.repoditor.saves.open(id);
          if (!opened.ok) return opened;
          return window.repoditor.saves.write(id, opened.data.session.fingerprint, [
            { feature: "run", entity: "run", field: "currency", after: 778 },
          ]);
        },
        { id: saveId },
      );
      expect(runBlocked).toMatchObject({ ok: false, error: { code: "game_running" } });
      expect((await readFile(savePath)).equals(runBeforeBlocked)).toBe(true);
      expect(
        (await readdir(path.dirname(savePath))).filter((name) =>
          name.startsWith(`${path.basename(savePath)}.bak-`),
        ),
      ).toHaveLength(runBackupsBefore);

      const metaBeforeBlocked = await readFile(metaPath);
      const metaBackupsBefore = (await readdir(path.dirname(metaPath))).filter((name) =>
        name.startsWith(`${path.basename(metaPath)}.bak-`),
      ).length;
      const cosmeticsBlocked = await page.evaluate(async () => {
        const opened = await window.repoditor.cosmetics.get();
        if (!opened.ok) return opened;
        return window.repoditor.cosmetics.write(opened.data.fingerprint, [
          { feature: "cosmetics", entity: "known", field: "unlockAll", after: true },
        ]);
      });
      expect(cosmeticsBlocked).toMatchObject({ ok: false, error: { code: "game_running" } });
      expect((await readFile(metaPath)).equals(metaBeforeBlocked)).toBe(true);
      expect(
        (await readdir(path.dirname(metaPath))).filter((name) =>
          name.startsWith(`${path.basename(metaPath)}.bak-`),
        ),
      ).toHaveLength(metaBackupsBefore);

      await checkAgain.click();
      await waitForGameRunningDialog(page);

      await terminateChildProcess(repoProcess, "synthetic REPO.exe");
      repoProcess = undefined;
      await waitForGameStatus(page, "not_running");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await waitForGameDialogClosed(page);
      await expect(page.getByTestId("workspace-pending-edit-count")).toHaveText("1 pending change");
    }
  } finally {
    try {
      if (repoProcess && repoProcess.exitCode === null) {
        await terminateChildProcess(repoProcess, "synthetic REPO.exe");
      }
    } finally {
      await harness?.dispose();
    }
  }
});
