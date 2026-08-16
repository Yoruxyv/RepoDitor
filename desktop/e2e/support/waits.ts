import { expect, type Page } from "@playwright/test";

const CROSS_PROCESS_TIMEOUT_MS = 15_000;

const SAVE_SURFACES = {
  cosmetics: {
    actionBarTestId: "cosmetics-action-bar",
    pendingCountTestId: "cosmetics-pending-edit-count",
  },
  workspace: {
    actionBarTestId: "workspace-action-bar",
    pendingCountTestId: "workspace-pending-edit-count",
  },
} as const;

type SaveSurface = keyof typeof SAVE_SURFACES;

export async function waitForDiscoveredSave(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /Open workspace/ })).toBeVisible({
    timeout: CROSS_PROCESS_TIMEOUT_MS,
  });
}

export async function waitForWorkspaceOrContinue(page: Page): Promise<void> {
  const workspace = page.getByTestId("workspace");
  const continueEditor = page.getByRole("button", { name: "Continue to editor" });

  await expect
    .poll(async () => (await workspace.isVisible()) || (await continueEditor.isVisible()), {
      message: "workspace or bounded asset-preparation escape should become available",
      timeout: CROSS_PROCESS_TIMEOUT_MS,
    })
    .toBe(true);

  if (await continueEditor.isVisible()) {
    await continueEditor.click();
  }
  await expect(workspace).toBeVisible({ timeout: CROSS_PROCESS_TIMEOUT_MS });
}

export async function waitForSafeSave(page: Page, surface: SaveSurface): Promise<void> {
  const target = SAVE_SURFACES[surface];
  const success = page
    .getByTestId(target.actionBarTestId)
    .getByText(/Saved safely · Backup created/);
  const pending = page.getByTestId(target.pendingCountTestId);

  await expect
    .poll(
      async () => ({
        pending: (await pending.textContent())?.trim() ?? null,
        success: await success.isVisible(),
      }),
      {
        message: `${surface} save should finish safely and clear pending edits`,
        timeout: CROSS_PROCESS_TIMEOUT_MS,
      },
    )
    .toEqual({
      pending: "No pending changes",
      success: true,
    });
}

export async function waitForStaleSave(page: Page, surface: SaveSurface): Promise<void> {
  const pending = page.getByTestId(SAVE_SURFACES[surface].pendingCountTestId);
  const alert = page.getByRole("alert");

  await expect
    .poll(
      async () => {
        const alerts = await alert.allTextContents();
        return {
          pending: (await pending.textContent())?.trim() ?? null,
          stale: alerts.some((text) => text.includes("changed on disk")),
        };
      },
      {
        message: `${surface} stale-save response should preserve the pending edit`,
        timeout: CROSS_PROCESS_TIMEOUT_MS,
      },
    )
    .toEqual({
      pending: "1 pending change",
      stale: true,
    });
}

export async function waitForGameStatus(
  page: Page,
  expected: "running" | "not_running",
): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await page.evaluate(() => window.repoditor.game.status());
        return result.ok ? result.data.status : `error:${result.error.code}`;
      },
      {
        message: `game process status should become ${expected}`,
        timeout: CROSS_PROCESS_TIMEOUT_MS,
      },
    )
    .toBe(expected);
}

export async function waitForGameRunningDialog(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "R.E.P.O. is currently running" })).toBeVisible({
    timeout: CROSS_PROCESS_TIMEOUT_MS,
  });
  await expect(page.getByTestId("editor-content")).toHaveAttribute("inert", "", {
    timeout: CROSS_PROCESS_TIMEOUT_MS,
  });
}

export async function waitForGameDialogClosed(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0, {
    timeout: CROSS_PROCESS_TIMEOUT_MS,
  });
  await expect
    .poll(
      () =>
        page
          .getByTestId("editor-content")
          .evaluate(
            (editor) =>
              editor === document.activeElement || editor.contains(document.activeElement),
          ),
      {
        message: "editor focus should be restored after the game-running dialog closes",
        timeout: CROSS_PROCESS_TIMEOUT_MS,
      },
    )
    .toBe(true);
}
