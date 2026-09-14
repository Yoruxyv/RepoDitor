// @vitest-environment node

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { LocalIconRegistry, readIconKey } = require("../../dist-electron/icons/registry.cjs");
const { serveLocalIcon } = require("../../dist-electron/icons/protocol.cjs");
const { DecodedUpgradeTextureCache } = require("../../dist-electron/icons/upgradeTextureCache.cjs");

function png(width = 1, height = 1): Buffer {
  const data = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  data.writeUInt32BE(13, 8);
  data.write("IHDR", 12, "ascii");
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "repoditor-icons-"));
  const roots = {
    item: path.join(base, "Items"),
    upgrade: path.join(base, "Items"),
    cosmetic: path.join(base, "Cosmetics"),
  };
  await mkdir(roots.item);
  await mkdir(roots.cosmetic);
  return { base, roots };
}

function url(token: string): Request {
  return new Request(`repoditor-icon://local/${token}`);
}

describe("local icon protocol", () => {
  it("releases an unfinished preparation waiter and permits a later lazy retry", async () => {
    const cache = new DecodedUpgradeTextureCache();
    const key = "playerUpgradeHealth";
    const client = { run: vi.fn().mockResolvedValue({ ok: true, texture: null }) };
    cache.beginPreparation([key]);
    const pending = cache.get(key, client);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(client.run).not.toHaveBeenCalled();
    cache.finishPreparation(key);
    await expect(pending).resolves.toBeNull();
    await expect(cache.get(key, client)).resolves.toBeNull();
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("serves only a valid registered PNG from its registered domain", async () => {
    const { roots } = await fixture();
    await writeFile(path.join(roots.item, "tool.png"), png());
    await writeFile(path.join(roots.cosmetic, "tool.png"), Buffer.from("wrong domain"));
    const registry = new LocalIconRegistry();
    const token = registry.replace("item", ["tool.png"]).get("tool.png");

    const response = await serveLocalIcon(url(token), roots, registry);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png());
  });

  it("preserves unchanged opaque tokens and invalidates removed registrations", () => {
    const registry = new LocalIconRegistry();
    const first = registry.replace("cosmetic", ["kept.png", "removed.png"]);
    const item = registry.replace("item", ["kept.png"]);
    const upgrade = registry.replace("upgrade", ["kept.png"]);
    const second = registry.replace("cosmetic", ["kept.png", "added.png"]);

    expect(second.get("kept.png")).toBe(first.get("kept.png"));
    expect(second.get("added.png")).not.toBe(first.get("removed.png"));
    expect(registry.get(first.get("removed.png"))).toBeUndefined();
    expect(registry.get(item.get("kept.png"))).toEqual({
      kind: "cache",
      domain: "item",
      key: "kept.png",
    });
    expect(registry.get(upgrade.get("kept.png"))).toEqual({
      kind: "cache",
      domain: "upgrade",
      key: "kept.png",
    });
  });

  it("rejects unknown tokens, arbitrary paths, bad files, and writes", async () => {
    const { roots } = await fixture();
    await writeFile(path.join(roots.item, "invalid.png"), Buffer.from("not png"));
    await writeFile(path.join(roots.item, "huge.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
    await writeFile(path.join(roots.item, "wide.png"), png(2049, 1));
    const registry = new LocalIconRegistry();
    const tokens = registry.replace("item", ["missing.png", "invalid.png", "huge.png", "wide.png"]);
    const missing = tokens.get("missing.png");
    const invalid = tokens.get("invalid.png");
    const huge = tokens.get("huge.png");
    const wide = tokens.get("wide.png");

    for (const request of [
      url("unknown"),
      new Request("repoditor-icon://local/../secret"),
      url(missing),
      url(invalid),
      url(huge),
      url(wide),
    ]) {
      expect((await serveLocalIcon(request, roots, registry)).status).toBe(404);
    }
    expect(
      (
        await serveLocalIcon(
          new Request(`repoditor-icon://local/${wide}`, { method: "POST" }),
          roots,
          registry,
        )
      ).status,
    ).toBe(405);
    expect(() => readIconKey("../secret.png")).toThrow();
    expect(() => registry.replace("item", ["wrong.txt"])).toThrow();
  });

  it("rejects a symlink candidate when the platform permits creating one", async () => {
    const { base, roots } = await fixture();
    const outside = path.join(base, "outside.png");
    await writeFile(outside, png());
    try {
      await symlink(outside, path.join(roots.item, "linked.png"), "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const registry = new LocalIconRegistry();
    const token = registry.replace("item", ["linked.png"]).get("linked.png");
    expect((await serveLocalIcon(url(token), roots, registry)).status).toBe(404);
  });

  it("keeps the real local cache PNG ahead of lazy texture decoding", async () => {
    const { roots } = await fixture();
    await writeFile(path.join(roots.item, "upgrade.png"), png());
    const registry = new LocalIconRegistry();
    const [token] = registry.replaceVisuals("upgrade", [
      { cacheKey: "upgrade.png", upgradeKey: "playerUpgradeHealth" },
    ]);
    const client = { run: vi.fn(), dispose: vi.fn() };

    const response = await serveLocalIcon(url(token), roots, registry, client);

    expect(response.status).toBe(200);
    expect(client.run).not.toHaveBeenCalled();
  });

  it("lazily decodes a missing cache icon once and reuses session memory", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const registry = new LocalIconRegistry();
    const [token] = registry.replaceVisuals("upgrade", [
      { cacheKey: null, upgradeKey: "playerUpgradeHealth" },
    ]);
    const client = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        texture: {
          sourceIdentity: "a".repeat(64),
          pngBase64: png().toString("base64"),
          width: 1,
          height: 1,
          watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
        },
      }),
      dispose: vi.fn(),
    };
    const diagnostics: Array<{ reason: string }> = [];
    const cache = new DecodedUpgradeTextureCache(null, (event: { reason: string }) =>
      diagnostics.push(event),
    );

    expect((await serveLocalIcon(url(token), null, registry, client, cache)).status).toBe(200);
    expect((await serveLocalIcon(url(token), null, registry, client, cache)).status).toBe(200);
    expect(client.run).toHaveBeenCalledTimes(1);
    expect(client.run).toHaveBeenCalledWith("upgrade-texture", ["playerUpgradeHealth"]);
    expect(diagnostics.map((event) => event.reason)).toContain("memory-hit");
  });

  it("lets background preparation satisfy an icon request without starting a duplicate lazy process", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const registry = new LocalIconRegistry();
    const [token] = registry.replaceVisuals("upgrade", [
      { cacheKey: null, upgradeKey: "playerUpgradeHealth" },
    ]);
    const client = { run: vi.fn(), dispose: vi.fn() };
    const cache = new DecodedUpgradeTextureCache();
    cache.beginPreparation(["playerUpgradeHealth"]);

    const response = serveLocalIcon(url(token), null, registry, client, cache);
    await Promise.resolve();
    expect(client.run).not.toHaveBeenCalled();

    await cache.storePrepared("playerUpgradeHealth", {
      sourceIdentity: "c".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });

    expect((await response).status).toBe(200);
    expect(client.run).not.toHaveBeenCalled();
  });

  it("serializes different upgrade decodes instead of spawning a process fan-out", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const registry = new LocalIconRegistry();
    const [healthToken, staminaToken] = registry.replaceVisuals("upgrade", [
      { cacheKey: null, upgradeKey: "playerUpgradeHealth" },
      { cacheKey: null, upgradeKey: "playerUpgradeStamina" },
    ]);
    let active = 0;
    let maximumActive = 0;
    let generation = 0;
    const client = {
      run: vi.fn().mockImplementation(async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        generation += 1;
        const identity = generation.toString(16).padStart(64, "0");
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return {
          ok: true,
          texture: {
            sourceIdentity: identity,
            pngBase64: png().toString("base64"),
            width: 1,
            height: 1,
            watches: [
              { path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() },
            ],
          },
        };
      }),
      dispose: vi.fn(),
    };
    const cache = new DecodedUpgradeTextureCache();

    const [health, stamina] = await Promise.all([
      serveLocalIcon(url(healthToken), null, registry, client, cache),
      serveLocalIcon(url(staminaToken), null, registry, client, cache),
    ]);

    expect(health.status).toBe(200);
    expect(stamina.status).toBe(200);
    expect(client.run).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
  });

  it("fails soft when lazy texture decoding is unavailable", async () => {
    const registry = new LocalIconRegistry();
    const [token] = registry.replaceVisuals("item", [
      { cacheKey: null, upgradeKey: "playerUpgradeMoonBoots" },
    ]);
    const client = {
      run: vi.fn().mockResolvedValue({ ok: true, texture: null }),
      dispose: vi.fn(),
    };

    expect((await serveLocalIcon(url(token), null, registry, client)).status).toBe(404);
  });

  it("shares one decoded session image across the Upgrades and Items consumers", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const registry = new LocalIconRegistry();
    const [upgradeToken] = registry.replaceVisuals("upgrade", [
      { cacheKey: null, upgradeKey: "playerUpgradeHealth" },
    ]);
    const [itemToken] = registry.replaceVisuals("item", [
      { cacheKey: null, upgradeKey: "playerUpgradeHealth" },
    ]);
    const client = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        texture: {
          sourceIdentity: "b".repeat(64),
          pngBase64: png().toString("base64"),
          width: 1,
          height: 1,
          watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
        },
      }),
      dispose: vi.fn(),
    };
    const cache = new DecodedUpgradeTextureCache();

    expect((await serveLocalIcon(url(upgradeToken), null, registry, client, cache)).status).toBe(
      200,
    );
    expect((await serveLocalIcon(url(itemToken), null, registry, client, cache)).status).toBe(200);
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("accepts validated batch textures into the same session cache used by lazy requests", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const diagnostics: Array<{ reason: string }> = [];
    const cache = new DecodedUpgradeTextureCache(null, (event: { reason: string }) =>
      diagnostics.push(event),
    );
    const payload = {
      sourceIdentity: "c".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    };
    const client = { run: vi.fn(), dispose: vi.fn() };

    await expect(cache.storePrepared("playerUpgradeHealth", payload)).resolves.toBe(true);
    await expect(cache.hasPrepared("playerUpgradeHealth")).resolves.toBe(true);
    await expect(cache.get("playerUpgradeHealth", client)).resolves.toEqual(png());
    expect(client.run).not.toHaveBeenCalled();
    expect(diagnostics.map((event) => event.reason)).toEqual(
      expect.arrayContaining(["source-decode-required", "memory-hit"]),
    );
  });

  it("rejects malformed batch texture payloads before they enter session memory", async () => {
    const cache = new DecodedUpgradeTextureCache();

    await expect(
      cache.storePrepared("playerUpgradeHealth", {
        sourceIdentity: "not-a-source-id",
        pngBase64: png().toString("base64"),
        width: 1,
        height: 1,
        watches: [],
      }),
    ).resolves.toBe(false);
    await expect(cache.hasPrepared("playerUpgradeHealth")).resolves.toBe(false);
  });

  it("invalidates decoded session memory when a watched installed source changes", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    await writeFile(watch, Buffer.from("source"));
    const registry = new LocalIconRegistry();
    const [token] = registry.replaceVisuals("upgrade", [
      { cacheKey: null, upgradeKey: "playerUpgradeHealth" },
    ]);
    let generation = 0;
    const client = {
      run: vi.fn().mockImplementation(async () => {
        const stat = await lstat(watch, { bigint: true });
        generation += 1;
        return {
          ok: true,
          texture: {
            sourceIdentity: generation.toString(16).padStart(64, "0"),
            pngBase64: png().toString("base64"),
            width: 1,
            height: 1,
            watches: [
              { path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() },
            ],
          },
        };
      }),
      dispose: vi.fn(),
    };
    const cache = new DecodedUpgradeTextureCache();

    expect((await serveLocalIcon(url(token), null, registry, client, cache)).status).toBe(200);
    await writeFile(watch, Buffer.from("changed source bytes"));
    expect((await serveLocalIcon(url(token), null, registry, client, cache)).status).toBe(200);
    expect(client.run).toHaveBeenCalledTimes(2);
  });

  it("persists validated decoded artwork and reuses it from a new cache instance", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const sourceIdentity = "d".repeat(64);
    const payload = {
      sourceIdentity,
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    };
    const firstClient = {
      run: vi.fn().mockResolvedValue({ ok: true, texture: payload }),
      dispose: vi.fn(),
    };
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);

    await expect(firstCache.get("playerUpgradeHealth", firstClient)).resolves.toEqual(png());
    expect(firstClient.run).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(persistentRoot, `${sourceIdentity}.png`))).toEqual(png());
    const manifest = JSON.parse(
      await readFile(path.join(persistentRoot, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.formatVersion).toBe(2);
    const artifactPath = path.join(persistentRoot, `${sourceIdentity}.png`);
    const manifestPath = path.join(persistentRoot, "manifest.json");
    const fixedTime = new Date("2024-01-02T03:04:05.000Z");
    await utimes(artifactPath, fixedTime, fixedTime);
    await utimes(manifestPath, fixedTime, fixedTime);
    const artifactBefore = await lstat(artifactPath, { bigint: true });
    const manifestBefore = await lstat(manifestPath, { bigint: true });

    const secondClient = { run: vi.fn(), dispose: vi.fn() };
    const diagnostics: Array<{ reason: string }> = [];
    const secondCache = new DecodedUpgradeTextureCache(
      persistentRoot,
      (event: { reason: string }) => diagnostics.push(event),
    );
    await expect(secondCache.get("playerUpgradeHealth", secondClient)).resolves.toEqual(png());
    expect(secondClient.run).not.toHaveBeenCalled();
    expect((await lstat(artifactPath, { bigint: true })).mtimeNs).toBe(artifactBefore.mtimeNs);
    expect((await lstat(manifestPath, { bigint: true })).mtimeNs).toBe(manifestBefore.mtimeNs);
    expect(diagnostics.map((event) => event.reason)).toContain("persistent-hit");
    expect(diagnostics.map((event) => event.reason)).not.toContain("source-decode-required");
    expect(diagnostics.map((event) => event.reason)).not.toContain("persisted");
  });

  it("keeps a persistent hit across appmanifest, BuildID, and assembly-only changes", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const appmanifest = path.join(base, "appmanifest_3241660.acf");
    const assembly = path.join(base, "Assembly-CSharp.dll");
    const persistentRoot = path.join(base, "presentation");
    const sourceIdentity = "0".repeat(64);
    await writeFile(watch, Buffer.from("source"));
    await writeFile(appmanifest, Buffer.from('"buildid" "old"'));
    await writeFile(assembly, Buffer.from("old assembly"));
    const stat = await lstat(watch, { bigint: true });
    const seeded = new DecodedUpgradeTextureCache(persistentRoot);
    await seeded.storePrepared("playerUpgradeHealth", {
      sourceIdentity,
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });
    const artifactPath = path.join(persistentRoot, `${sourceIdentity}.png`);
    const manifestPath = path.join(persistentRoot, "manifest.json");
    const artifactBefore = await lstat(artifactPath, { bigint: true });
    const manifestBefore = await lstat(manifestPath, { bigint: true });
    const diagnostics: Array<{ reason: string }> = [];
    const expectPersistentHit = async () => {
      const client = { run: vi.fn(), dispose: vi.fn() };
      const cache = new DecodedUpgradeTextureCache(persistentRoot, (event: { reason: string }) =>
        diagnostics.push(event),
      );
      await expect(cache.get("playerUpgradeHealth", client)).resolves.toEqual(png());
      expect(client.run).not.toHaveBeenCalled();
    };

    await utimes(appmanifest, new Date("2025-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"));
    await expectPersistentHit();
    await writeFile(appmanifest, Buffer.from('"AppState" { "buildid" "new" }'));
    await writeFile(assembly, Buffer.from("new assembly"));
    await expectPersistentHit();

    expect((await lstat(artifactPath, { bigint: true })).mtimeNs).toBe(artifactBefore.mtimeNs);
    expect((await lstat(manifestPath, { bigint: true })).mtimeNs).toBe(manifestBefore.mtimeNs);
    expect(diagnostics.map((event) => event.reason)).toEqual(["persistent-hit", "persistent-hit"]);
  });

  it("prunes unreferenced derived PNGs while reusing the valid persistent entry", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const sourceIdentity = "a".repeat(64);
    const orphanIdentity = "b".repeat(64);
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await firstCache.storePrepared("playerUpgradeHealth", {
      sourceIdentity,
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });
    await writeFile(path.join(persistentRoot, `${orphanIdentity}.png`), png());

    const client = { run: vi.fn(), dispose: vi.fn() };
    const secondCache = new DecodedUpgradeTextureCache(persistentRoot);
    await expect(secondCache.get("playerUpgradeHealth", client)).resolves.toEqual(png());

    expect(client.run).not.toHaveBeenCalled();
    await expect(lstat(path.join(persistentRoot, `${sourceIdentity}.png`))).resolves.toBeTruthy();
    await expect(lstat(path.join(persistentRoot, `${orphanIdentity}.png`))).rejects.toThrow();
  });

  it("prepares only a newly requested asset when an existing persistent entry is still valid", async () => {
    const { base } = await fixture();
    const healthWatch = path.join(base, "health.assets");
    const staminaWatch = path.join(base, "stamina.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(healthWatch, Buffer.from("health source"));
    await writeFile(staminaWatch, Buffer.from("stamina source"));
    const healthStat = await lstat(healthWatch, { bigint: true });
    const staminaStat = await lstat(staminaWatch, { bigint: true });
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await expect(
      firstCache.storePrepared("playerUpgradeHealth", {
        sourceIdentity: "e".repeat(64),
        pngBase64: png().toString("base64"),
        width: 1,
        height: 1,
        watches: [
          {
            path: healthWatch,
            size: healthStat.size.toString(),
            mtimeNs: healthStat.mtimeNs.toString(),
          },
        ],
      }),
    ).resolves.toBe(true);

    const client = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        texture: {
          sourceIdentity: "f".repeat(64),
          pngBase64: png().toString("base64"),
          width: 1,
          height: 1,
          watches: [
            {
              path: staminaWatch,
              size: staminaStat.size.toString(),
              mtimeNs: staminaStat.mtimeNs.toString(),
            },
          ],
        },
      }),
      dispose: vi.fn(),
    };
    const secondCache = new DecodedUpgradeTextureCache(persistentRoot);

    await expect(secondCache.get("playerUpgradeHealth", client)).resolves.toEqual(png());
    await expect(secondCache.get("playerUpgradeStamina", client)).resolves.toEqual(png());
    expect(client.run).toHaveBeenCalledTimes(1);
    expect(client.run).toHaveBeenCalledWith("upgrade-texture", ["playerUpgradeStamina"]);
  });

  it("invalidates only the persistent entry whose independent source watch changed", async () => {
    const { base } = await fixture();
    const healthWatch = path.join(base, "health.assets");
    const staminaWatch = path.join(base, "stamina.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(healthWatch, Buffer.from("health source"));
    await writeFile(staminaWatch, Buffer.from("stamina source"));
    const healthStat = await lstat(healthWatch, { bigint: true });
    const staminaStat = await lstat(staminaWatch, { bigint: true });
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await firstCache.storePrepared("playerUpgradeHealth", {
      sourceIdentity: "1".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [
        {
          path: healthWatch,
          size: healthStat.size.toString(),
          mtimeNs: healthStat.mtimeNs.toString(),
        },
      ],
    });
    await firstCache.storePrepared("playerUpgradeStamina", {
      sourceIdentity: "2".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [
        {
          path: staminaWatch,
          size: staminaStat.size.toString(),
          mtimeNs: staminaStat.mtimeNs.toString(),
        },
      ],
    });
    await writeFile(healthWatch, Buffer.from("changed health source bytes"));
    const changedHealthStat = await lstat(healthWatch, { bigint: true });
    const client = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        texture: {
          sourceIdentity: "3".repeat(64),
          pngBase64: png().toString("base64"),
          width: 1,
          height: 1,
          watches: [
            {
              path: healthWatch,
              size: changedHealthStat.size.toString(),
              mtimeNs: changedHealthStat.mtimeNs.toString(),
            },
          ],
        },
      }),
      dispose: vi.fn(),
    };
    const secondCache = new DecodedUpgradeTextureCache(persistentRoot);

    await expect(secondCache.get("playerUpgradeStamina", client)).resolves.toEqual(png());
    expect(client.run).not.toHaveBeenCalled();
    await expect(secondCache.get("playerUpgradeHealth", client)).resolves.toEqual(png());
    expect(client.run).toHaveBeenCalledTimes(1);
    expect(client.run).toHaveBeenCalledWith("upgrade-texture", ["playerUpgradeHealth"]);
  });

  it("rebuilds once for an mtime-only source change, then reuses the rebuilt artifact", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("same-size-source"));
    const initialStat = await lstat(watch, { bigint: true });
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await firstCache.storePrepared("playerUpgradeHealth", {
      sourceIdentity: "a".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [
        {
          path: watch,
          size: initialStat.size.toString(),
          mtimeNs: initialStat.mtimeNs.toString(),
        },
      ],
    });
    await utimes(watch, new Date("2025-01-01T00:00:00Z"), new Date("2025-01-01T00:00:00Z"));
    const changedStat = await lstat(watch, { bigint: true });
    expect(changedStat.size).toBe(initialStat.size);
    expect(changedStat.mtimeNs).not.toBe(initialStat.mtimeNs);
    const payload = {
      sourceIdentity: "b".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [
        {
          path: watch,
          size: changedStat.size.toString(),
          mtimeNs: changedStat.mtimeNs.toString(),
        },
      ],
    };
    const diagnostics: Array<{ reason: string }> = [];
    const rebuildClient = {
      run: vi.fn().mockResolvedValue({ ok: true, texture: payload }),
      dispose: vi.fn(),
    };
    const rebuiltCache = new DecodedUpgradeTextureCache(
      persistentRoot,
      (event: { reason: string }) => diagnostics.push(event),
    );

    await expect(rebuiltCache.get("playerUpgradeHealth", rebuildClient)).resolves.toEqual(png());
    expect(rebuildClient.run).toHaveBeenCalledTimes(1);
    expect(diagnostics.map((event) => event.reason)).toEqual([
      "source-changed",
      "source-decode-required",
      "persisted",
    ]);

    const warmClient = { run: vi.fn(), dispose: vi.fn() };
    const warmDiagnostics: Array<{ reason: string }> = [];
    const warmCache = new DecodedUpgradeTextureCache(persistentRoot, (event: { reason: string }) =>
      warmDiagnostics.push(event),
    );
    await expect(warmCache.get("playerUpgradeHealth", warmClient)).resolves.toEqual(png());
    expect(warmClient.run).not.toHaveBeenCalled();
    expect(warmDiagnostics.map((event) => event.reason)).toEqual(["persistent-hit"]);
  });

  it("rebuilds a corrupt persistent PNG with an explicit artifact reason", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const firstIdentity = "c".repeat(64);
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await firstCache.storePrepared("playerUpgradeHealth", {
      sourceIdentity: firstIdentity,
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });
    await writeFile(path.join(persistentRoot, `${firstIdentity}.png`), Buffer.alloc(24));
    const diagnostics: Array<{ reason: string }> = [];
    const client = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        texture: {
          sourceIdentity: "d".repeat(64),
          pngBase64: png().toString("base64"),
          width: 1,
          height: 1,
          watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
        },
      }),
      dispose: vi.fn(),
    };
    const cache = new DecodedUpgradeTextureCache(persistentRoot, (event: { reason: string }) =>
      diagnostics.push(event),
    );

    await expect(cache.get("playerUpgradeHealth", client)).resolves.toEqual(png());
    expect(client.run).toHaveBeenCalledTimes(1);
    expect(diagnostics.map((event) => event.reason)).toContain("artifact-invalid");
  });

  it("keeps valid manifest entries when a sibling entry is malformed", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    for (const [upgradeKey, sourceIdentity] of [
      ["playerUpgradeHealth", "e".repeat(64)],
      ["playerUpgradeStamina", "f".repeat(64)],
    ]) {
      await firstCache.storePrepared(upgradeKey, {
        sourceIdentity,
        pngBase64: png().toString("base64"),
        width: 1,
        height: 1,
        watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
      });
    }
    const manifestPath = path.join(persistentRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      entries: Record<string, { sourceIdentity: string }>;
    };
    manifest.entries.playerUpgradeHealth.sourceIdentity = "invalid";
    await writeFile(manifestPath, JSON.stringify(manifest));
    const diagnostics: Array<{ reason: string }> = [];
    const client = { run: vi.fn(), dispose: vi.fn() };
    const cache = new DecodedUpgradeTextureCache(persistentRoot, (event: { reason: string }) =>
      diagnostics.push(event),
    );

    await expect(cache.get("playerUpgradeStamina", client)).resolves.toEqual(png());
    expect(client.run).not.toHaveBeenCalled();
    expect(diagnostics.map((event) => event.reason)).toEqual(
      expect.arrayContaining(["manifest-invalid", "persistent-hit"]),
    );
  });

  it("rejects old cache formats and malformed or incomplete persistent entries", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const sourceIdentity = "4".repeat(64);
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await firstCache.storePrepared("playerUpgradeHealth", {
      sourceIdentity,
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });

    const manifestPath = path.join(persistentRoot, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      formatVersion: number;
    };
    await writeFile(manifestPath, JSON.stringify({ ...manifest, formatVersion: 1 }));
    const oldFormatClient = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        texture: {
          sourceIdentity: "5".repeat(64),
          pngBase64: png().toString("base64"),
          width: 1,
          height: 1,
          watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
        },
      }),
      dispose: vi.fn(),
    };
    await expect(
      new DecodedUpgradeTextureCache(persistentRoot).get("playerUpgradeHealth", oldFormatClient),
    ).resolves.toEqual(png());
    expect(oldFormatClient.run).toHaveBeenCalledTimes(1);

    await writeFile(manifestPath, "{ malformed");
    const malformedClient = {
      run: vi.fn().mockResolvedValue({ ok: true, texture: null }),
      dispose: vi.fn(),
    };
    await expect(
      new DecodedUpgradeTextureCache(persistentRoot).get("playerUpgradeHealth", malformedClient),
    ).resolves.toBeNull();
    expect(malformedClient.run).toHaveBeenCalledTimes(1);
  });

  it("fails safe when the persistent manifest cannot be read", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const seeded = new DecodedUpgradeTextureCache(persistentRoot);
    await seeded.storePrepared("playerUpgradeHealth", {
      sourceIdentity: "6".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });
    const readFailure = Object.assign(new Error("fixture access denied"), { code: "EACCES" });
    const readSpy = vi.spyOn(fs, "readFile").mockRejectedValueOnce(readFailure);
    const diagnostics: Array<{ reason: string }> = [];
    const client = {
      run: vi.fn().mockResolvedValue({ ok: true, texture: null }),
      dispose: vi.fn(),
    };

    try {
      await expect(
        new DecodedUpgradeTextureCache(persistentRoot, (event: { reason: string }) =>
          diagnostics.push(event),
        ).get("playerUpgradeHealth", client),
      ).resolves.toBeNull();
    } finally {
      readSpy.mockRestore();
    }
    expect(client.run).toHaveBeenCalledTimes(1);
    expect(diagnostics.map((event) => event.reason)).toEqual([
      "manifest-unreadable",
      "entry-missing",
      "source-decode-required",
    ]);
  });

  it("falls back to source preparation when a referenced persistent PNG is missing", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const sourceIdentity = "6".repeat(64);
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await firstCache.storePrepared("playerUpgradeHealth", {
      sourceIdentity,
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });
    await rm(path.join(persistentRoot, `${sourceIdentity}.png`));
    const client = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        texture: {
          sourceIdentity: "7".repeat(64),
          pngBase64: png().toString("base64"),
          width: 1,
          height: 1,
          watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
        },
      }),
      dispose: vi.fn(),
    };

    await expect(
      new DecodedUpgradeTextureCache(persistentRoot).get("playerUpgradeHealth", client),
    ).resolves.toEqual(png());
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("does not present a stale persistent artifact after its source disappears", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "presentation");
    await writeFile(watch, Buffer.from("source"));
    const stat = await lstat(watch, { bigint: true });
    const firstCache = new DecodedUpgradeTextureCache(persistentRoot);
    await firstCache.storePrepared("playerUpgradeHealth", {
      sourceIdentity: "8".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    });
    await rm(watch);
    const client = {
      run: vi.fn().mockResolvedValue({ ok: true, texture: null }),
      dispose: vi.fn(),
    };

    await expect(
      new DecodedUpgradeTextureCache(persistentRoot).get("playerUpgradeHealth", client),
    ).resolves.toBeNull();
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("keeps decoded session memory usable when persistent cache writes fail", async () => {
    const { base } = await fixture();
    const watch = path.join(base, "resources.assets");
    const persistentRoot = path.join(base, "not-a-directory");
    await writeFile(watch, Buffer.from("source"));
    await writeFile(persistentRoot, Buffer.from("blocks cache directory creation"));
    const stat = await lstat(watch, { bigint: true });
    const diagnostics: Array<{ reason: string }> = [];
    const cache = new DecodedUpgradeTextureCache(persistentRoot, (event: { reason: string }) =>
      diagnostics.push(event),
    );
    const payload = {
      sourceIdentity: "9".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [{ path: watch, size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString() }],
    };
    const client = { run: vi.fn(), dispose: vi.fn() };

    await expect(cache.storePrepared("playerUpgradeHealth", payload)).resolves.toBe(true);
    await expect(cache.get("playerUpgradeHealth", client)).resolves.toEqual(png());
    expect(client.run).not.toHaveBeenCalled();
    expect(diagnostics.map((event) => event.reason)).toEqual(
      expect.arrayContaining(["source-decode-required", "persist-failed", "memory-hit"]),
    );
  });
});
