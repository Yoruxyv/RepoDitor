// @vitest-environment node

import { createRequire } from "node:module";
import { lstat, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { LocalIconRegistry, readIconKey } = require("../../dist-electron/icons/registry.cjs");
const {
  DecodedUpgradeTextureCache,
  serveLocalIcon,
} = require("../../dist-electron/icons/protocol.cjs");

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
    const cache = new DecodedUpgradeTextureCache();

    expect((await serveLocalIcon(url(token), null, registry, client, cache)).status).toBe(200);
    expect((await serveLocalIcon(url(token), null, registry, client, cache)).status).toBe(200);
    expect(client.run).toHaveBeenCalledTimes(1);
    expect(client.run).toHaveBeenCalledWith("upgrade-texture", ["playerUpgradeHealth"]);
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
    const cache = new DecodedUpgradeTextureCache();
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
});
