import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createRunSaveFixture,
  DESKTOP_ROOT,
  getPythonExecutable,
  E2E_SAVE_ID,
  PYTHON_ROOT,
} from "../support/fixtureEnvironment";
import { createGameFixture } from "../support/harness";
import {
  close,
  launch,
  native,
  stageSyntheticBackend,
  stageFrozenBackend,
} from "../support/tauriHarness";

function prepared(name: string): string {
  const artifact = process.env[name];
  if (!artifact) throw new Error(`${name} must name a prepared native artifact`);
  return path.resolve(DESKTOP_ROOT, artifact);
}

test("ordinary native upgrade artwork is scoped, validated, refreshed and read-only", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("artwork");
  await mkdir(home, { recursive: true });
  const fixture = await stageSyntheticBackend(
    home,
    prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"),
  );
  const key = fixture.upgrades[0].key;
  const png = execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import base64; from repo_save_editor.services.texture_codec import encode_rgba_png; print(base64.b64encode(encode_rgba_png(bytes([255,40,20,255]),1,1)).decode())",
    ],
    {
      cwd: PYTHON_ROOT,
      env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
      windowsHide: true,
      encoding: "utf8",
    },
  ).trim();
  await writeFile(
    path.join(home, "upgrades-list.json"),
    JSON.stringify({
      ok: true,
      fingerprint: fixture.opened.session.fingerprint,
      upgrades: fixture.upgrades,
    }),
  );
  const image = {
    upgradeKey: key,
    sourceIdentity: "a".repeat(64),
    width: 1,
    height: 1,
    pngBase64: png,
  };
  const response = path.join(home, "upgrade-artwork.json");
  await writeFile(response, JSON.stringify({ ok: true, artwork: image }));
  const app = await launch(fixture.executable, home, fixture.environment);
  try {
    const page = app.page;
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    const icon = page.getByTestId(`upgrade-icon-${key}`);
    await expect(icon).toHaveAttribute("data-artwork-revision", image.sourceIdentity);
    await expect
      .poll(() => icon.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(1);
    const current = await native<{ ok: boolean; data: Array<{ key: string; iconToken: string }> }>(
      page,
      "upgrades_list",
      { saveId: E2E_SAVE_ID },
    );
    expect(current.ok).toBe(true);
    const token = current.data.find((row) => row.key === key)!.iconToken;
    expect(token).toMatch(/^upgrade-artwork:[0-9a-f]{32}$/);
    for (const forged of [
      "../../private.png",
      "https://example.test/a.png",
      token.replace("upgrade-artwork:", "map-artwork:"),
      `upgrade-artwork:${"0".repeat(32)}`,
    ]) {
      expect(
        (await native<{ ok: boolean }>(page, "upgrade_artwork_get", { token: forged })).ok,
      ).toBe(false);
    }
    // Re-open the workspace so UI rows receive the current registration.
    await page.getByRole("button", { name: "Change save", exact: true }).click();
    await expect
      .poll(async () => (await native<{ ok: boolean }>(page, "upgrade_artwork_get", { token })).ok)
      .toBe(false);
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await expect(icon).toHaveAttribute("data-artwork-revision", image.sourceIdentity);
    await page.screenshot({ path: info.outputPath("native-upgrade-artwork.png") });
    const next = { ...image, sourceIdentity: "b".repeat(64) };
    await writeFile(response, JSON.stringify({ ok: true, artwork: next }));
    await page.getByRole("tab", { name: "Players", exact: true }).click();
    await page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await expect(icon).toHaveAttribute("data-artwork-revision", next.sourceIdentity);
    await writeFile(
      response,
      JSON.stringify({
        ok: true,
        artwork: { ...next, pngBase64: Buffer.from("not a PNG").toString("base64") },
      }),
    );
    await page.getByRole("tab", { name: "Players", exact: true }).click();
    await page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    await expect(icon).not.toHaveAttribute("data-icon-source", "local");
    await writeFile(response, JSON.stringify({ ok: true, artwork: next }));
    const refreshed = await native<{
      ok: boolean;
      data: Array<{ key: string; iconToken: string }>;
    }>(page, "upgrades_list", { saveId: E2E_SAVE_ID });
    const currentToken = refreshed.data.find((row) => row.key === key)!.iconToken;
    expect(
      (await native<{ ok: boolean }>(page, "upgrade_artwork_get", { token: currentToken })).ok,
    ).toBe(true);
    await native(page, "saves_open", { saveId: E2E_SAVE_ID });
    expect(
      (await native<{ ok: boolean }>(page, "upgrade_artwork_get", { token: currentToken })).ok,
    ).toBe(false);
    await expect(native(page, "test_health_write", { request: {} })).rejects.toBeDefined();
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary frozen upgrade artwork rejects unreviewed sources without affecting save reads", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("frozen-artwork");
  await mkdir(home, { recursive: true });
  const save = await createRunSaveFixture(home);
  const before = await readFile(save);
  await createGameFixture(home);
  const executable = path.join(home, "repoditor-preview.exe");
  await copyFile(prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"), executable);
  await stageFrozenBackend(home, prepared("REPODITOR_ARTIFACT_BACKEND"));
  const app = await launch(executable, home);
  try {
    const opened = await native<{ ok: boolean }>(app.page, "saves_open", { saveId: E2E_SAVE_ID });
    expect(opened.ok).toBe(true);
    const rows = await native<{ ok: boolean; data: Array<{ iconToken: string | null }> }>(
      app.page,
      "upgrades_list",
      { saveId: E2E_SAVE_ID },
    );
    expect(rows.ok).toBe(true);
    const token = rows.data.find((row) => row.iconToken !== null)?.iconToken;
    expect(token).toMatch(/^upgrade-artwork:[0-9a-f]{32}$/);
    expect(await native(app.page, "upgrade_artwork_get", { token })).toEqual({
      ok: true,
      data: null,
    });
    expect(await readFile(save)).toEqual(before);
    await expect(native(app.page, "test_health_write", { request: {} })).rejects.toBeDefined();
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary native Item artwork displays beyond the upgrade budget and stays read-only", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("item-art");
  await mkdir(home, { recursive: true });
  const fixture = await stageSyntheticBackend(
    home,
    prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"),
  );
  const items = Array.from({ length: 24 }, (_, index) => {
    const name = "Tool " + String(index).padStart(2, "0");
    return { ...fixture.advanced.items[0], name, saveKey: "Item " + name + "/1", instanceId: "1" };
  });
  await writeFile(
    path.join(home, "advanced-get.json"),
    JSON.stringify({
      ok: true,
      fingerprint: fixture.opened.session.fingerprint,
      advanced: { ...fixture.advanced, items },
    }),
  );
  const png = execFileSync(
    getPythonExecutable(),
    [
      "-c",
      "import base64; from repo_save_editor.services.texture_codec import encode_rgba_png; print(base64.b64encode(encode_rgba_png(bytes([20,80,255,255]),1,1)).decode())",
    ],
    {
      cwd: PYTHON_ROOT,
      env: { ...process.env, PYTHONPATH: PYTHON_ROOT },
      windowsHide: true,
      encoding: "utf8",
    },
  ).trim();
  const response = path.join(home, "item-artwork.json");
  const image = {
    itemName: "Item Tool 23",
    sourceIdentity: "c".repeat(64),
    width: 1,
    height: 1,
    pngBase64: png,
  };
  await writeFile(response, JSON.stringify({ ok: true, artwork: image }));
  const app = await launch(fixture.executable, home, fixture.environment);
  try {
    const page = app.page;
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    const icon = page.getByTestId("item-icon-Item Tool 23/1");
    await icon.scrollIntoViewIfNeeded();
    await expect(icon).toHaveAttribute("data-artwork-revision", image.sourceIdentity);
    await expect
      .poll(() => icon.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(1);
    const missing = page.getByTestId("item-icon-Item Tool 00/1");
    await missing.scrollIntoViewIfNeeded();
    await expect(missing).not.toHaveAttribute("data-icon-source", "local");
    const current = await native<{
      ok: boolean;
      data: { items: Array<{ name: string; iconToken: string }> };
    }>(page, "advanced_get", { saveId: E2E_SAVE_ID });
    expect(current.ok).toBe(true);
    expect(current.data.items).toHaveLength(items.length);
    for (const item of current.data.items)
      expect(item.iconToken).toMatch(/^item-artwork:[0-9a-f]{32}$/);
    const token = current.data.items.find((item) => item.name === "Tool 23")!.iconToken;
    const wrong = current.data.items.find((item) => item.name === "Tool 22")!.iconToken;
    for (const [command, supplied] of [
      ["upgrade_artwork_get", token],
      ["item_artwork_get", token.replace("item-", "upgrade-")],
      ["item_artwork_get", "item-artwork:" + "0".repeat(32)],
      ["item_artwork_get", wrong],
    ])
      expect((await native<{ ok: boolean }>(page, command, { token: supplied })).ok).toBe(false);
    await writeFile(response, JSON.stringify({ ok: true, artwork: null }));
    expect(await native(page, "item_artwork_get", { token })).toEqual({ ok: true, data: null });
    await writeFile(
      response,
      JSON.stringify({ ok: true, artwork: { ...image, pngBase64: "AAAA" } }),
    );
    expect((await native<{ ok: boolean }>(page, "item_artwork_get", { token })).ok).toBe(false);
    await writeFile(response, JSON.stringify({ ok: true, artwork: image }));
    expect((await native<{ ok: boolean }>(page, "item_artwork_get", { token })).ok).toBe(true);
    await native(page, "saves_open", { saveId: E2E_SAVE_ID });
    expect((await native<{ ok: boolean }>(page, "item_artwork_get", { token })).ok).toBe(false);
    await expect(native(page, "test_items_refill", { request: {} })).rejects.toBeDefined();
  } finally {
    await close(app.child, app.browser);
  }
});
