import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type TestInfo } from "@playwright/test";
import { createRunSaveFixture, DESKTOP_ROOT } from "./support/fixtureEnvironment";
import { createGameFixture } from "./support/harness";
import { close, launch, stageFrozenBackend } from "./support/tauriHarness";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must name a prepared safety artifact`);
  return path.resolve(DESKTOP_ROOT, value);
}
async function fixture(info: TestInfo, ordinary = false) {
  const home = info.outputPath("isolated");
  await mkdir(home, { recursive: true });
  const source = await createRunSaveFixture(home);
  await createGameFixture(home);
  const executable = path.join(home, "repoditor-preview.exe");
  await copyFile(
    required(ordinary ? "REPODITOR_RECOVERY_DEFAULT_EXECUTABLE" : "REPODITOR_SAFETY_UI_HOST"),
    executable,
  );
  await stageFrozenBackend(home, required("REPODITOR_RECOVERY_BACKEND"));
  return { home, source, executable, before: await readFile(source) };
}
async function openUpgrades(app: Awaited<ReturnType<typeof launch>>) {
  await app.page.getByRole("button", { name: /Open workspace/ }).click();
  await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "editing");
  await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
  await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toBeVisible();
}

test("synthetic upgrade drafts review and revert without writing save or receipt bytes", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openUpgrades(app);
    const alpha = app.page.getByRole("spinbutton", { name: "Strength for Alpha" });
    await alpha.fill("3");
    await alpha.press("Tab");
    await app.page.getByRole("combobox", { name: "Player", exact: true }).click();
    await app.page.getByRole("option", { name: "Beta", exact: true }).click();
    const beta = app.page.getByRole("spinbutton", { name: "Strength for Beta" });
    await beta.fill("2147483647");
    await beta.press("Tab");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "2 pending changes",
    );
    await app.page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(app.page.getByTestId("workspace-review")).toContainText("Alpha · Strength");
    await expect(app.page.getByTestId("workspace-review")).toContainText("0 → 2147483647");
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    await expect(
      app.page.getByText(
        "Saving upgrades is unavailable in this preview. Revert upgrade drafts before saving health.",
      ),
    ).toBeVisible();
    const tab = app.page.getByRole("tab", { name: "Upgrades", exact: true });
    await tab.focus();
    await tab.press("ArrowLeft");
    await app.page.getByRole("tab", { name: "Players", exact: true }).press("ArrowRight");
    await expect(tab).toBeFocused();
    await expect(beta).toHaveValue("2147483647");
    await beta.fill("2147483648");
    await expect(beta).toHaveAttribute("aria-invalid", "true");
    await expect(app.page.getByRole("alert")).toContainText("2,147,483,647");
    await app.page.getByRole("button", { name: "Revert upgrade drafts", exact: true }).click();
    await expect(beta).toHaveValue("0");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    await beta.fill("4");
    for (const width of [960, 1200, 1600]) {
      await app.page.setViewportSize({ width, height: 900 });
      expect(
        await app.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await app.page.screenshot({ path: info.outputPath(`upgrade-draft-${width}.png`) });
    }
    await app.page.getByRole("button", { name: "Revert all", exact: true }).click();
    await expect(beta).toHaveValue("0");
    await beta.fill("5");
    await app.page.getByRole("button", { name: "Change save", exact: true }).click();
    await openUpgrades(app);
    await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toHaveValue("2");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "No pending changes",
    );
    expect(await readFile(f.source)).toEqual(f.before);
    expect(
      (await readdir(path.dirname(f.source))).filter(
        (name) => (name.includes("health") && !name.endsWith(".lock")) || name.includes(".bak"),
      ),
    ).toEqual([]);
  } finally {
    await close(app.child, app.browser);
  }
});

test("upgrade drafts block partial health Save until explicitly reverted", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await openUpgrades(app);
    await app.page.getByRole("spinbutton", { name: "Strength for Alpha" }).fill("3");
    await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    const health = app.page.getByRole("spinbutton", { name: "Current health", exact: true });
    await health.fill("17");
    await health.press("Tab");
    await expect(app.page.getByTestId("workspace-pending-edit-count")).toHaveText(
      "2 pending changes",
    );
    await expect(
      app.page.getByRole("button", { name: "Save Changes", exact: true }),
    ).toBeDisabled();
    expect(await readFile(f.source)).toEqual(f.before);
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await app.page.getByRole("button", { name: "Revert upgrade drafts", exact: true }).click();
    await app.page.getByRole("tab", { name: "Players", exact: true }).click();
    await app.page.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(app.page.getByTestId("health-status")).toHaveAttribute("data-phase", "saved");
    const backups = (await readdir(path.dirname(f.source))).filter((name) =>
      name.includes(".bak-health-"),
    );
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(path.dirname(f.source), backups[0]))).toEqual(f.before);
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await expect(app.page.getByRole("spinbutton", { name: "Strength for Alpha" })).toHaveValue("2");
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary artifact retains read-only upgrades with no draft controls", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const f = await fixture(info, true);
  const app = await launch(f.executable, f.home, {
    REPODITOR_RECOVERY_SYNTHETIC_STATUS: "not_running",
  });
  try {
    await app.page.getByRole("button", { name: /Open workspace/ }).click();
    await app.page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    const value = app.page.getByRole("textbox", { name: "Strength for Alpha" });
    await expect(value).toHaveAttribute("readonly");
    await value.focus();
    await value.press("ArrowUp");
    await expect(value).toHaveValue("2");
    await expect(app.page.getByRole("spinbutton")).toHaveCount(0);
    await expect(
      app.page.getByRole("button", { name: "Revert upgrade drafts", exact: true }),
    ).toHaveCount(0);
    expect(await readFile(f.source)).toEqual(f.before);
  } finally {
    await close(app.child, app.browser);
  }
});
