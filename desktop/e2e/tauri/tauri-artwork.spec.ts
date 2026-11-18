import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import {
  createMetaSaveFixture,
  createRunSaveFixture,
  DESKTOP_ROOT,
  getPythonExecutable,
  E2E_SAVE_ID,
  PYTHON_ROOT,
  stageTestExecutable,
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

test("ordinary native Cosmetics revisit reads once and uses only current artwork", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("revisit");
  const fixture = await stageSyntheticBackend(
    home,
    prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"),
  );
  await mkdir(path.join(home, "AppData", "LocalLow", "semiwork", "Repo"), { recursive: true });
  const meta = createMetaSaveFixture(home);
  const original = await readFile(meta);
  async function setSource(
    version: string,
    sourceVersion = version,
    pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4ryHyHwAFoAI7Y0OAZQAAAABJRU5ErkJggg==",
    pngVersion = "d",
  ) {
    const revision = version.repeat(64);
    await writeFile(
      path.join(home, "cosmetics-get.json"),
      JSON.stringify({
        ok: true,
        cosmetics: {
          ...fixture.cosmetics,
          fingerprint: revision,
          artworkProofs: {
            0: [revision, "c".repeat(32), pngVersion.repeat(64), "e".repeat(64)].join(":"),
          },
        },
      }),
    );
    await writeFile(
      path.join(home, "native-cosmetic-artwork.json"),
      JSON.stringify({
        ok: true,
        artwork: {
          cosmeticId: 0,
          sourceIdentity: sourceVersion.repeat(64),
          width: 1,
          height: 1,
          pngBase64,
        },
      }),
    );
  }
  await setSource("a");
  const app = await launch(fixture.executable, home, fixture.environment);
  try {
    const { page } = app;
    await page.setViewportSize({ width: 960, height: 640 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const artworkTokens: Array<string | null> = [];
    const catalog = await page.evaluateHandle(() => {
      const originalFetch = window.fetch.bind(window);
      const release: Record<string, () => void> = {};
      const hold = (stage: string) =>
        new Promise<void>((resolve) => {
          release[stage] = resolve;
        });
      const catalogs = [hold("initial"), hold("revisit")];
      const artwork = hold("artwork");
      const observation = { reads: 0, artworkStarted: false, release };
      // WebView2 handles custom IPC URLs outside Playwright request routing.
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.hostname === "ipc.localhost") {
          if (url.pathname === "/cosmetics_get") {
            const wait = catalogs[observation.reads++];
            if (wait) await wait;
          }
          if (url.pathname === "/cosmetic_artwork_get" && !observation.artworkStarted) {
            observation.artworkStarted = true;
            await artwork;
          }
        }
        return originalFetch(input, init);
      };
      return observation;
    });
    const catalogReads = () => catalog.evaluate(({ reads }) => reads);
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/cosmetic_artwork_get") {
        const body = request.postDataJSON() as { token?: string } | null;
        artworkTokens.push(body?.token ?? null);
      }
    });
    const open = page.getByRole("button", { name: "Cosmetics", exact: true });
    const search = page.getByRole("searchbox", { name: "Search cosmetics" });
    const icon = page.getByTestId("cosmetic-icon-0");
    const card = page.getByRole("listitem", { name: /Installed Cosmetic 0,/ });
    async function measure(frame: Locator) {
      const layout = await frame.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const row = node.closest("li")!.getBoundingClientRect();
        const label = node.parentElement!.querySelector("[title]")!.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          cardHeight: row.height,
          labelX: label.x - row.x,
          labelY: label.y - row.y,
          labelWidth: label.width,
        };
      });
      expect(layout).toMatchObject({ width: 48, height: 48 });
      return layout;
    }
    async function expectArtwork(version: string) {
      await card.scrollIntoViewIfNeeded();
      await expect(icon).toHaveAttribute("data-artwork-revision", version.repeat(64));
      await expect(icon).toHaveAttribute("aria-busy", "false");
      await expect(icon.locator("img")).toHaveAttribute("alt", "");
    }
    await open.click();
    const preparation = page.getByRole("heading", { name: "Preparing cosmetic artwork" });
    await expect(preparation).toBeVisible();
    await expect(search).toBeHidden();
    await catalog.evaluate(({ release }) => release.initial());
    await expect.poll(() => catalog.evaluate(({ artworkStarted }) => artworkStarted)).toBe(true);
    await expect(preparation).toBeVisible();
    await expect(search).toBeHidden();
    await catalog.evaluate(({ release }) => release.artwork());
    await expectArtwork("a");
    await search.fill("Installed Cosmetic 0");
    await expect(page.getByText(/images load as you browse/i)).toHaveCount(0);
    const layout = await measure(icon);
    expect(await catalogReads()).toBe(1);
    expect(artworkTokens).toEqual([expect.stringMatching(/^cosmetic-artwork:[0-9a-f]{32}$/)]);

    await page.getByRole("button", { name: "Run Saves", exact: true }).click();
    await setSource("b");
    await open.click();
    await expect.poll(catalogReads).toBe(2);
    await expect(preparation).toBeVisible();
    await expect(search).toBeHidden();
    expect(artworkTokens).toHaveLength(1);
    await catalog.evaluate(({ release }) => release.revisit());
    await expectArtwork("b");
    await expect(search).toHaveValue("Installed Cosmetic 0");
    expect(await measure(icon)).toEqual(layout);
    expect(await catalogReads()).toBe(2);
    expect(artworkTokens).toHaveLength(2);
    expect(artworkTokens[1]).not.toBe(artworkTokens[0]);

    await setSource("c");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expectArtwork("c");
    expect(await measure(icon)).toEqual(layout);
    expect(await catalogReads()).toBe(3);
    expect(artworkTokens).toHaveLength(3);
    expect(new Set(artworkTokens).size).toBe(3);

    await page.getByRole("button", { name: "Run Saves", exact: true }).click();
    await open.click();
    await expectArtwork("c");
    expect(await catalogReads()).toBe(4);
    expect(artworkTokens).toHaveLength(3);

    await setSource("c", "c", undefined, "f");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expectArtwork("c");
    expect(await catalogReads()).toBe(5);
    expect(artworkTokens).toHaveLength(4);

    for (const [version, source, pixels] of [
      ["d", "c", undefined],
      ["e", "e", "AAAA"],
    ] as const) {
      const nextRequest = artworkTokens.length + 1;
      await setSource(version, source, pixels);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await card.scrollIntoViewIfNeeded();
      await expect.poll(() => artworkTokens.length).toBe(nextRequest);
      await expect(icon).toHaveAttribute("data-icon-source", "fallback");
      await expect(icon.locator("img")).toHaveCount(0);
      expect(await measure(icon)).toEqual(layout);
    }
    expect(await catalogReads()).toBe(7);
    expect(new Set(artworkTokens).size).toBe(6);
    await search.fill("999");
    const missing = page.getByTestId("cosmetic-icon-999");
    await expect(missing).toHaveAttribute("data-icon-source", "fallback");
    for (const [width, height] of [
      [1600, 900],
      [1200, 800],
      [960, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await measure(missing);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    await expect(page.getByTestId("workspace")).toHaveCount(0);
    await expect(native(page, "test_meta_write", { request: {} })).rejects.toBeDefined();
    expect(await readFile(meta)).toEqual(original);
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary native Cosmetics load visible canonical icons without a Run save", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("cosmetic-artwork");
  const fixture = await stageSyntheticBackend(
    home,
    prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"),
  );
  const revision = "b".repeat(64);
  const proof = [revision, "c".repeat(32), "d".repeat(64), "e".repeat(64)].join(":");
  const cosmetics = {
    ...fixture.cosmetics,
    knownCatalogCount: 559,
    knownLockedCount: 558,
    cosmetics: [
      ...Array.from({ length: 559 }, (_, id) => ({
        ...fixture.cosmetics.cosmetics[0],
        id,
        displayName: `Hat ${String(id).padStart(3, "0")}`,
        owned: id === 0,
        state: id === 0 ? "owned" : "locked",
        mutationEligible: id === 0,
        removalBlockedReason: id === 0 ? null : "Read only",
      })),
      fixture.cosmetics.cosmetics.at(-1),
    ],
    artworkProofs: { 0: proof, 279: proof, 558: proof, 999: proof },
  };
  await writeFile(path.join(home, "cosmetics-get.json"), JSON.stringify({ ok: true, cosmetics }));
  const batchArtwork = path.join(home, "native-cosmetic-artwork-batch.json");
  const image = (cosmeticId: number) => ({
    cosmeticId,
    sourceIdentity: revision,
    width: 1,
    height: 1,
    pngBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4ryHyHwAFoAI7Y0OAZQAAAABJRU5ErkJggg==",
  });
  await writeFile(
    batchArtwork,
    JSON.stringify({ ok: true, artworks: [image(0), image(279), image(558)] }),
  );
  const app = await launch(fixture.executable, home, fixture.environment);
  try {
    const { page } = app;
    await page.getByRole("button", { name: "Cosmetics", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search cosmetics" });
    await expect(search).toBeVisible();
    await page.getByTestId("cosmetic-icon-0").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("cosmetic-icon-0")).toHaveAttribute(
      "data-artwork-revision",
      revision,
    );
    await expect(page.getByTestId("cosmetic-icon-558").locator("img")).toHaveAttribute(
      "loading",
      "eager",
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/cosmetic_artwork_get")) requests.push(request.url());
    });
    for (const id of [279, 558]) {
      await search.fill(`Hat ${id}`);
      const icon = page.getByTestId(`cosmetic-icon-${id}`);
      await icon.scrollIntoViewIfNeeded();
      await expect(icon).toHaveAttribute("data-artwork-revision", revision);
      await expect
        .poll(() =>
          icon.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth),
        )
        .toBe(1);
    }
    expect(requests).toEqual([]);
    await search.fill("999");
    await expect(page.getByTestId("cosmetic-icon-999")).toHaveAttribute(
      "data-icon-source",
      "fallback",
    );
    const projection = await native<{
      ok: boolean;
      data: { cosmetics: { id: number; iconToken: string | null }[] };
    }>(page, "cosmetics_get");
    expect(projection.ok).toBe(true);
    expect(JSON.stringify(projection)).not.toContain("artworkProofs");
    expect(projection.data.cosmetics.find((entry) => entry.id === 999)?.iconToken).toBeNull();
    const token = projection.data.cosmetics.find((entry) => entry.id === 558)?.iconToken;
    expect(token).toMatch(/^cosmetic-artwork:[0-9a-f]{32}$/);
    expect(await native(page, "map_artwork_get", { token })).toMatchObject({ ok: false });
    expect(
      await native(page, "cosmetic_artwork_get", { token: `cosmetic-artwork:${"0".repeat(32)}` }),
    ).toMatchObject({ ok: false });
    const tokens = [0, 279, 558].map(
      (id) => projection.data.cosmetics.find((entry) => entry.id === id)?.iconToken,
    );
    expect(tokens).toEqual(
      Array.from({ length: 3 }, () => expect.stringMatching(/^cosmetic-artwork:/)),
    );
    await expect(
      native(page, "cosmetic_artwork_get", { tokens: [token, token] }),
    ).resolves.toMatchObject({ ok: false });
    await writeFile(batchArtwork, JSON.stringify({ ok: true, artworks: [image(0)] }));
    await expect(native(page, "cosmetic_artwork_get", { tokens })).resolves.toMatchObject({
      ok: false,
    });
    await writeFile(
      batchArtwork,
      JSON.stringify({ ok: true, artworks: [image(0), image(558), false] }),
    );
    await expect(native(page, "cosmetic_artwork_get", { tokens })).resolves.toMatchObject({
      ok: true,
      data: [{ token: tokens[0], revision }, null, false],
    });
    await page.getByRole("button", { name: "Run Saves", exact: true }).click();
    await expect
      .poll(async () => native(page, "cosmetic_artwork_get", { token }))
      .toMatchObject({ ok: false });
    await expect(native(page, "cosmetic_artwork_get", { tokens })).resolves.toMatchObject({
      ok: false,
    });
    await expect(native(page, "test_meta_write", { request: {} })).rejects.toBeDefined();
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary native Maps prepare scoped previews and revoke old artwork", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("maps-artwork");
  await mkdir(home, { recursive: true });
  const fixture = await stageSyntheticBackend(
    home,
    prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"),
  );
  const map = fixture.maps.maps[0];
  const image = {
    mapFamily: map.internalName,
    sourceIdentity: map.artworkRevision,
    width: 1,
    height: 1,
    pngBase64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4ryHyHwAFoAI7Y0OAZQAAAABJRU5ErkJggg==",
  };
  const artwork = path.join(home, "map-artwork.json");
  await writeFile(artwork, JSON.stringify({ ok: true, artwork: image }));
  const marker = path.join(home, "map-started.txt");
  await writeFile(marker, "");
  const app = await launch(fixture.executable, home, {
    ...fixture.environment,
    REPODITOR_TEST_STARTED_FILE: marker,
    REPODITOR_TEST_DELAY_COMMAND: "map-artwork",
  });
  try {
    const { page } = app;
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect.poll(() => readFile(marker, "utf8")).toBe("map-artwork");
    await expect(page.getByRole("tab", { name: "Maps", selected: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Maps", exact: true }).click();
    const icon = page.getByTestId(`map-artwork-${map.internalName}`);
    await expect(icon).toHaveAttribute("data-artwork-revision", image.sourceIdentity!);
    await expect
      .poll(() => icon.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(1);
    await expect(page.getByTestId("map-artwork-Modded Moon")).toHaveAttribute(
      "data-icon-source",
      "fallback",
    );
    const catalog = await native<{
      ok: boolean;
      data: { catalogPath: null; maps: { iconToken: string }[] };
    }>(page, "maps_list");
    expect(catalog).toMatchObject({ ok: true, data: { catalogPath: null } });
    const token = catalog.data.maps[0].iconToken;
    expect(token).toMatch(/^map-artwork:[0-9a-f]{32}$/);
    for (const [command, forged] of [
      ["item_artwork_get", token],
      ["map_artwork_get", token.replace("map-", "upgrade-")],
      ["map_artwork_get", `map-artwork:${"0".repeat(32)}`],
      ["map_artwork_get", "../../private.png"],
    ]) {
      expect(await native(page, command, { token: forged })).toMatchObject({ ok: false });
    }
    await writeFile(
      artwork,
      JSON.stringify({ ok: true, artwork: { ...image, sourceIdentity: "b".repeat(64) } }),
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(icon).toHaveAttribute("data-icon-source", "fallback");
    expect(await native(page, "map_artwork_get", { token })).toMatchObject({ ok: false });
    await expect(page.getByRole("heading", { name: map.displayName })).toBeVisible();
    await expect(native(page, "test_items_refill", { request: {} })).rejects.toBeDefined();
  } finally {
    await close(app.child, app.browser);
  }
});

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
  async function setSource(revision: string) {
    await writeFile(
      path.join(home, "maps-list.json"),
      JSON.stringify({ ok: true, ...fixture.maps, entryArtworkRevision: revision }),
    );
  }
  await setSource("1".repeat(64));
  await writeFile(response, JSON.stringify({ ok: true, artwork: image }));
  const app = await launch(fixture.executable, home, fixture.environment);
  try {
    const page = app.page;
    async function refreshArtwork(artwork: typeof image, revision: string) {
      await writeFile(response, JSON.stringify({ ok: true, artwork }));
      await setSource(revision);
      const proof = page.waitForResponse(
        (reply) =>
          new URL(reply.url()).pathname === "/maps_list" &&
          reply.request().postDataJSON()?.validateOnly === true,
      );
      await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
      expect(await proof.then((reply) => reply.json())).toMatchObject({
        ok: true,
        data: { entryArtworkRevision: revision },
      });
      await page.getByRole("tab", { name: "Players", exact: true }).click();
      await page.getByRole("tab", { name: "Upgrades", exact: true }).click();
    }
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
    await refreshArtwork(next, "2".repeat(64));
    await expect(icon).toHaveAttribute("data-artwork-revision", next.sourceIdentity);
    await refreshArtwork(
      { ...next, pngBase64: Buffer.from("not a PNG").toString("base64") },
      "3".repeat(64),
    );
    await expect(icon).toHaveAttribute("data-icon-source", /category|specific|fallback/);
    await writeFile(response, JSON.stringify({ ok: true, artwork: next }));
    const refreshed = await native<{
      ok: boolean;
      data: Array<{ key: string; iconToken: string }>;
    }>(page, "upgrades_list", { saveId: E2E_SAVE_ID });
    const currentToken = refreshed.data.find((row) => row.key === key)!.iconToken;
    expect(
      (await native<{ ok: boolean }>(page, "upgrade_artwork_get", { token: currentToken })).ok,
    ).toBe(true);
    await writeFile(
      path.join(home, "upgrades-list.json"),
      JSON.stringify({ ok: true, fingerprint: "d".repeat(64), upgrades: fixture.upgrades }),
    );
    await expect(
      native(page, "upgrades_list", { saveId: E2E_SAVE_ID, background: true }),
    ).resolves.toMatchObject({ ok: false, error: { code: "save_stale" } });
    await native(page, "saves_open", { saveId: E2E_SAVE_ID });
    expect(
      (await native<{ ok: boolean }>(page, "upgrade_artwork_get", { token: currentToken })).ok,
    ).toBe(false);
    await expect(native(page, "test_health_write", { request: {} })).rejects.toBeDefined();
  } finally {
    await close(app.child, app.browser);
  }
});

test("ordinary native upgrade artwork groups settle valid and missing images together", async ({
  browserName,
}, info) => {
  expect(browserName).toBe("chromium");
  const home = info.outputPath("upgrade-artwork-group");
  const fixture = await stageSyntheticBackend(
    home,
    prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"),
  );
  const first = fixture.upgrades[0];
  const missing = { ...first, key: "playerUpgradeUnknown", label: "Unknown" };
  await writeFile(
    path.join(home, "upgrades-list.json"),
    JSON.stringify({
      ok: true,
      fingerprint: fixture.opened.session.fingerprint,
      upgrades: [first, missing],
    }),
  );
  const batch = path.join(home, "upgrade-artwork-batch.json");
  const maps = path.join(home, "maps-list.json");
  async function setSource(revision: string) {
    await writeFile(
      maps,
      JSON.stringify({
        ok: true,
        ...fixture.maps,
        entryArtworkRevision: revision,
      }),
    );
  }
  async function setArtwork(revision: string) {
    await writeFile(
      batch,
      JSON.stringify({
        ok: true,
        artworks: [
          {
            upgradeKey: first.key,
            sourceIdentity: revision,
            width: 1,
            height: 1,
            pngBase64:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4ryHyHwAFoAI7Y0OAZQAAAABJRU5ErkJggg==",
          },
          null,
        ],
      }),
    );
  }
  await setArtwork("a".repeat(64));
  await setSource("1".repeat(64));
  const app = await launch(fixture.executable, home, fixture.environment);
  try {
    const { page } = app;
    const calls: number[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/upgrade_artwork_get") {
        const payload = request.postDataJSON();
        calls.push(payload.tokens?.length ?? 1);
      }
    });
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
    expect(calls).toEqual([2]);
    const tab = page.getByRole("tab", { name: "Upgrades", exact: true });
    const image = page.getByTestId(`upgrade-icon-${first.key}`);
    const fallback = page.getByTestId(`upgrade-icon-${missing.key}`);
    await tab.click();
    expect(await image.getAttribute("aria-busy")).toBe("false");
    await expect(image.locator("img.opacity-100")).toBeVisible();
    await expect(fallback).toHaveAttribute("data-icon-source", /category|specific|fallback/);
    expect(calls).toEqual([2]);

    const focusProof = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/maps_list" &&
        response.request().postDataJSON()?.validateOnly === true,
    );
    await page.evaluate(() => {
      window.dispatchEvent(new FocusEvent("blur"));
      window.dispatchEvent(new FocusEvent("focus"));
    });
    await focusProof;
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await tab.click();
    await expect(image).toHaveAttribute("data-artwork-revision", "a".repeat(64));
    await expect
      .poll(() =>
        image.locator("img.opacity-100").evaluate((node) => {
          const png = node as HTMLImageElement;
          return png.complete && png.naturalWidth > 0;
        }),
      )
      .toBe(true);
    await expect(fallback).toHaveAttribute("data-icon-source", /category|specific|fallback/);
    expect(calls).toEqual([2]);

    const open = page.getByRole("button", { name: /Open workspace/ });
    const closeEditor = () => page.getByRole("button", { name: "Change save" }).click();
    await closeEditor();
    await expect(open).toBeVisible();
    await expect(image).toHaveCount(0);
    await open.click();
    await tab.click();
    await expect(image).toHaveAttribute("data-artwork-revision", "a".repeat(64));
    expect(calls).toEqual([2]);
    await closeEditor();

    await setSource("2".repeat(64));
    await setArtwork("b".repeat(64));
    await open.click();
    await tab.click();
    await expect(image).toHaveAttribute("data-artwork-revision", "b".repeat(64));
    expect(calls).toEqual([2, 2]);
    await closeEditor();

    await setSource("3".repeat(64));
    await writeFile(batch, JSON.stringify({ ok: true, artworks: [] }));
    await open.click();
    await expect(
      page.getByText("Upgrades · 2 previews could not be extracted or validated"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("artwork-defer-choice.png") });
    await setArtwork("b".repeat(64));
    await page.getByRole("button", { name: "Continue without remaining artwork" }).click();
    await expect(page.getByRole("heading", { name: "Run snapshot" })).toBeVisible();
    await expect(page.getByText(/2 artwork previews deferred/)).toBeVisible();
    await tab.click();
    await expect(image).toHaveAttribute("data-artwork-revision", "b".repeat(64));
    expect(calls).toEqual([2, 2, 2, 2]);
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
  await stageTestExecutable(prepared("REPODITOR_RECOVERY_DEFAULT_EXECUTABLE"), executable);
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
  await writeFile(
    path.join(home, "item-artwork-batch.json"),
    JSON.stringify({ ok: true, artworks: items.map((_, index) => (index === 23 ? image : null)) }),
  );
  const app = await launch(fixture.executable, home, fixture.environment);
  try {
    const page = app.page;
    await page.getByRole("button", { name: /Open workspace/ }).click();
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search items" });
    await search.fill("Tool 23");
    const icon = page.getByTestId("item-icon-Item Tool 23/1");
    await icon.scrollIntoViewIfNeeded();
    await expect(icon).toHaveAttribute("data-artwork-revision", image.sourceIdentity);
    await expect
      .poll(() => icon.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(1);
    await search.fill("Tool 00");
    const missing = page.getByTestId("item-icon-Item Tool 00/1");
    await page.getByTestId("item-group-Tool 00").scrollIntoViewIfNeeded();
    await expect(missing).toHaveAttribute("data-icon-source", /category|specific|fallback/);
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
