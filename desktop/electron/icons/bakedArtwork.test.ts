// @vitest-environment node
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { readPngBytes } = require("../../dist-electron/icons/localPng.cjs");
const { validPngContents } = require("../../dist-electron/icons/png.cjs");
const { InstalledBakedArtwork } = require("../../dist-electron/icons/bakedArtwork.cjs");
const {
  DecodedCosmeticArtworkCache,
} = require("../../dist-electron/icons/cosmeticArtworkCache.cjs");

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(name: string, bytes: Buffer): Buffer {
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length);
  result.write(name, 4, "ascii");
  bytes.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}

function png(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 11, 22, 33, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repoditor-baked-"));
  homes.push(root);
  const itemRoot = path.join(root, "REPO_Data", "StreamingAssets", "BakedIcons", "Items");
  const cosmeticRoot = path.join(root, "REPO_Data", "StreamingAssets", "BakedIcons", "Cosmetics");
  await fs.mkdir(itemRoot, { recursive: true });
  await fs.mkdir(cosmeticRoot);
  const sources = await Promise.all(
    Array.from({ length: 5 }, async (_, i) => {
      const file = path.join(root, `source-${i}`);
      await fs.writeFile(file, "source");
      const info = await fs.stat(file, { bigint: true });
      return {
        path: file,
        size: String(info.size),
        mtimeNs: String(info.mtimeNs),
        device: String(info.dev),
        inode: String(info.ino),
      };
    }),
  );
  const itemName = "a".repeat(32) + ".png";
  const cosmeticName = "b".repeat(32) + ".png";
  const artwork = {
    root,
    sources,
    item: { "Item Tool": itemName },
    cosmetic: { "547": cosmeticName },
  };
  await fs.writeFile(path.join(itemRoot, itemName), png());
  await fs.writeFile(path.join(cosmeticRoot, cosmeticName), png());
  const client = {
    run: vi.fn().mockResolvedValue({ ok: true, artwork }),
    dispose: vi.fn(),
    runRecords: vi.fn(),
  };
  return { root, itemRoot, cosmeticRoot, itemName, cosmeticName, artwork, client };
}

function decodedCache(root: string) {
  const cache = new DecodedCosmeticArtworkCache({ availableCosmetics: async () => new Set() });
  cache.configurePersistentRoot(root);
  return cache;
}

describe("validated installed baked artwork", () => {
  it("bounds reads and handles partial reads and truncation without allocating source size", async () => {
    const content = Buffer.from("abcdef");
    const read = vi.fn(async (target: Buffer, offset: number, length: number, position: number) => {
      const part = content.subarray(position, position + Math.min(length, 2));
      part.copy(target, offset);
      return { bytesRead: part.length };
    });
    expect(await readPngBytes({ read }, 6n)).toEqual(content);
    expect(read).toHaveBeenCalledTimes(3);
    read.mockClear();
    expect(await readPngBytes({ read }, 2n * 1024n * 1024n + 1n)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(await readPngBytes({ read: async () => ({ bytesRead: 0 }) }, 6n)).toBeNull();
  });

  it("serves only canonical identities and deduplicates metadata loading", async () => {
    const { itemRoot, client } = await fixture();
    await fs.writeFile(path.join(itemRoot, "c".repeat(32) + ".png"), png());
    const source = new InstalledBakedArtwork();
    const [item, cosmetic, extra] = await Promise.all([
      source.get("item", "Item Tool", client),
      source.get("cosmetic", "547", client),
      source.get("cosmetic", "557", client),
    ]);
    expect(item).toEqual(png());
    expect(cosmetic).toEqual(png());
    expect(extra).toBeNull();
    expect(client.run).toHaveBeenCalledExactlyOnceWith("baked-artwork");
    expect(await source.availableCosmetics([547, 556], client)).toEqual(new Set([547]));
    expect(await source.availableItems(["Item Tool", "Item Unknown"], client)).toEqual(
      new Set(["Item Tool"]),
    );
  });

  it("never requests LocalLow roots for missing or corrupt regular-item artwork", async () => {
    const { client, itemRoot, itemName } = await fixture();
    const source = new InstalledBakedArtwork();
    await fs.rm(path.join(itemRoot, itemName));
    expect(await source.availableItems(["Item Tool"], client)).toEqual(new Set());
    await fs.writeFile(path.join(itemRoot, itemName), Buffer.from("bad PNG"));
    expect(await source.availableItems(["Item Tool"], client)).toEqual(new Set());
    expect(await source.get("item", "Item Tool", client)).toBeNull();
    expect(client.run).toHaveBeenCalledExactlyOnceWith("baked-artwork");
  });

  it("rejects malformed chunks, CRC failures, missing end markers and oversized files", async () => {
    const { cosmeticRoot, cosmeticName, client } = await fixture();
    const source = new InstalledBakedArtwork();
    const badCrc = Buffer.from(png());
    badCrc[badCrc.length - 1] ^= 1;
    for (const data of [
      Buffer.from("bad"),
      png().subarray(0, 24),
      badCrc,
      png().subarray(0, -12),
      Buffer.alloc(2 * 1024 * 1024 + 1),
    ]) {
      await fs.writeFile(path.join(cosmeticRoot, cosmeticName), data);
      expect(await source.get("cosmetic", "547", client)).toBeNull();
      expect(validPngContents(data)).toBe(false);
    }
  });

  it("rejects valid-CRC PNGs with malformed, oversized or invalid-filter pixel streams", () => {
    const good = png();
    for (const compressed of [
      Buffer.from("not deflate"),
      deflateSync(Buffer.alloc(10000)),
      deflateSync(Buffer.from([7, 11, 22, 33, 255])),
    ]) {
      const invalid = Buffer.concat([
        good.subarray(0, 33),
        chunk("IDAT", compressed),
        good.subarray(-12),
      ]);
      expect(validPngContents(invalid)).toBe(false);
    }
  });

  it("reuses persisted validation stamps after relaunch and revalidates changed PNGs", async () => {
    const { root, client, cosmeticRoot, cosmeticName } = await fixture();
    const cacheRoot = path.join(root, "validation");
    const first = new InstalledBakedArtwork();
    first.configurePersistentRoot(cacheRoot);
    expect(await first.availableCosmetics([547], client)).toEqual(new Set([547]));
    expect(await fs.readdir(cacheRoot)).toEqual(["manifest.json"]);
    const manifest = path.join(cacheRoot, "manifest.json");
    const before = await fs.stat(manifest, { bigint: true });
    const open = vi.spyOn(fs, "open");
    try {
      const relaunched = new InstalledBakedArtwork();
      relaunched.configurePersistentRoot(cacheRoot);
      expect(await relaunched.availableCosmetics([547], client)).toEqual(new Set([547]));
      expect(open).not.toHaveBeenCalled();
      expect((await fs.stat(manifest, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
      await fs.writeFile(path.join(cosmeticRoot, cosmeticName), Buffer.from("changed PNG"));
      expect(await relaunched.availableCosmetics([547], client)).toEqual(new Set());
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      open.mockRestore();
    }
  });

  it("does not rewrite warm validation when image requests arrive before readiness", async () => {
    const { root, client } = await fixture();
    const cacheRoot = path.join(root, "validation");
    const first = new InstalledBakedArtwork();
    first.configurePersistentRoot(cacheRoot);
    await first.availableCosmetics([547], client);
    const manifest = path.join(cacheRoot, "manifest.json");
    const before = await fs.stat(manifest, { bigint: true });
    const relaunched = new InstalledBakedArtwork();
    relaunched.configurePersistentRoot(cacheRoot);
    expect(await relaunched.get("cosmetic", "547", client)).toEqual(png());
    expect(await relaunched.availableCosmetics([547], client)).toEqual(new Set([547]));
    expect((await fs.stat(manifest, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
  });

  it("treats malformed validation metadata and unwritable persistence as disposable", async () => {
    const { root, client } = await fixture();
    const cacheRoot = path.join(root, "validation");
    await fs.mkdir(cacheRoot);
    await fs.writeFile(path.join(cacheRoot, "manifest.json"), "{");
    const first = new InstalledBakedArtwork();
    first.configurePersistentRoot(cacheRoot);
    expect(await first.availableCosmetics([547], client)).toEqual(new Set([547]));
    const unavailable = path.join(root, "file-as-directory");
    await fs.writeFile(unavailable, "fixture");
    const second = new InstalledBakedArtwork();
    second.configurePersistentRoot(unavailable);
    expect(await second.availableCosmetics([547], client)).toEqual(new Set([547]));
  });

  it("rejects unsafe filenames, duplicate mappings and noncanonical IDs", async () => {
    const { artwork, client } = await fixture();
    for (const cosmetic of [
      { "547": "../secret.png" },
      { "0547": "a".repeat(32) + ".png" },
      { "3": "b".repeat(32) + ".png", "547": "b".repeat(32) + ".png" },
    ]) {
      client.run.mockResolvedValue({ ok: true, artwork: { ...artwork, cosmetic } });
      expect(await new InstalledBakedArtwork().get("cosmetic", "547", client)).toBeNull();
    }
  });

  it("rejects a junction replacing the installed category directory", async () => {
    const { root, cosmeticRoot, cosmeticName, client } = await fixture();
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, cosmeticName), png());
    await fs.rm(cosmeticRoot, { recursive: true });
    await fs.symlink(outside, cosmeticRoot, process.platform === "win32" ? "junction" : "dir");
    expect(await new InstalledBakedArtwork().get("cosmetic", "547", client)).toBeNull();
  });

  it("invalidates a removed/corrupt PNG without redoing metadata discovery", async () => {
    const { cosmeticRoot, cosmeticName, client } = await fixture();
    const source = new InstalledBakedArtwork();
    expect(await source.availableCosmetics([547], client)).toEqual(new Set([547]));
    await fs.rm(path.join(cosmeticRoot, cosmeticName));
    expect(await source.availableCosmetics([547], client)).toEqual(new Set());
    await fs.writeFile(path.join(cosmeticRoot, cosmeticName), Buffer.from("bad"));
    expect(await source.get("cosmetic", "547", client)).toBeNull();
    await fs.writeFile(path.join(cosmeticRoot, cosmeticName), png());
    expect(await source.availableCosmetics([547], client)).toEqual(new Set([547]));
    expect(client.run).toHaveBeenCalledTimes(1);
  });

  it("fails soft after build/source changes instead of serving stale mappings", async () => {
    const { artwork, client } = await fixture();
    const source = new InstalledBakedArtwork();
    expect(await source.get("cosmetic", "547", client)).toEqual(png());
    await fs.writeFile(artwork.sources[0].path, "changed source");
    client.run.mockResolvedValue({ ok: true, artwork: null });
    expect(await source.get("cosmetic", "547", client)).toBeNull();
    expect(client.run).toHaveBeenCalledTimes(2);
  });

  it("coalesces source-change discovery for concurrent requests", async () => {
    const { artwork, client } = await fixture();
    const source = new InstalledBakedArtwork();
    expect(await source.get("cosmetic", "547", client)).toEqual(png());
    await fs.writeFile(artwork.sources[0].path, "changed source");
    client.run.mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      return { ok: true, artwork: null };
    });
    expect(
      await Promise.all([
        source.get("cosmetic", "547", client),
        source.get("cosmetic", "547", client),
      ]),
    ).toEqual([null, null]);
    expect(client.run).toHaveBeenCalledTimes(2);
  });

  it("reuses decoded Sprites after relaunch and repairs a corrupt owned PNG without LocalLow", async () => {
    const { root, artwork } = await fixture();
    const persistent = path.join(root, "decoded");
    const watch = artwork.sources[0];
    const payload = {
      cosmeticId: 547,
      sourceIdentity: "d".repeat(64),
      pngBase64: png().toString("base64"),
      width: 1,
      height: 1,
      watches: [watch],
    };
    const decoder = { run: vi.fn().mockResolvedValue({ ok: true, artwork: payload }) };
    expect(await decodedCache(persistent).get(547, decoder)).toEqual(png());
    expect(decoder.run).toHaveBeenCalledExactlyOnceWith("cosmetic-artwork", ["547"]);
    const untouched = { run: vi.fn() };
    expect(await decodedCache(persistent).get(547, untouched)).toEqual(png());
    expect(untouched.run).not.toHaveBeenCalled();
    const file = (await fs.readdir(persistent)).find((name) => name.endsWith(".png"))!;
    await fs.writeFile(path.join(persistent, file), Buffer.from("corrupt owned artifact"));
    decoder.run.mockClear();
    const repaired = decodedCache(persistent);
    expect(await Promise.all([repaired.get(547, decoder), repaired.get(547, decoder)])).toEqual([
      png(),
      png(),
    ]);
    expect(decoder.run).toHaveBeenCalledExactlyOnceWith("cosmetic-artwork", ["547"]);
  });

  it("invalidates only the decoded Sprite whose installed source changed", async () => {
    const { root, artwork } = await fixture();
    const persistent = path.join(root, "decoded");
    const decoder = {
      run: vi.fn(async (_command: string, ids: string[]) => {
        const id = Number(ids[0]);
        const watchPath = artwork.sources[id === 547 ? 0 : 1].path;
        const stat = await fs.stat(watchPath, { bigint: true });
        return {
          ok: true,
          artwork: {
            cosmeticId: id,
            sourceIdentity: "e".repeat(64),
            pngBase64: png().toString("base64"),
            width: 1,
            height: 1,
            watches: [{ path: watchPath, size: String(stat.size), mtimeNs: String(stat.mtimeNs) }],
          },
        };
      }),
    };
    const first = decodedCache(persistent);
    await first.get(547, decoder);
    await first.get(556, decoder);
    decoder.run.mockClear();
    await fs.writeFile(artwork.sources[0].path, "changed installed source");
    const next = decodedCache(persistent);
    expect(await next.get(556, decoder)).toEqual(png());
    expect(decoder.run).not.toHaveBeenCalled();
    expect(await next.get(547, decoder)).toEqual(png());
    expect(decoder.run).toHaveBeenCalledExactlyOnceWith("cosmetic-artwork", ["547"]);
  });

  it("opens verified warm/relaunched catalogs without preparation or PNG copying", async () => {
    const { root, client } = await fixture();
    for (let launch = 0; launch < 2; launch += 1) {
      const cache = new DecodedCosmeticArtworkCache(new InstalledBakedArtwork());
      const phases: string[] = [];
      cache.subscribePreparation((state: { phase: string }) => phases.push(state.phase));
      cache.prefetch([547], client);
      await vi.waitFor(() => expect(cache.getPreparationState().phase).toBe("ready"));
      cache.prefetch([547], client);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      expect(phases).not.toContain("checking");
      expect(phases).not.toContain("preparing");
    }
    expect(client.runRecords).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).not.toContain("manifest.json");
  });

  it("keeps verified artwork available and prepares only missing IDs in background", async () => {
    const { client } = await fixture();
    const cache = new DecodedCosmeticArtworkCache(new InstalledBakedArtwork());
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    client.runRecords.mockImplementation(
      async (_command: string, ids: string[], onRecord: (value: unknown) => Promise<void>) => {
        expect(ids).toEqual(["556"]);
        await pending;
        await onRecord({ type: "texture", cosmeticId: 556, artwork: null, completed: 1, total: 1 });
        return { type: "final", ok: true, completed: 1, total: 1 };
      },
    );
    cache.prefetch([547, 556], client);
    cache.prefetch([547, 556], client);
    await vi.waitFor(() =>
      expect(cache.getPreparationState()).toMatchObject({
        phase: "preparing",
        cached: 1,
        total: 2,
      }),
    );
    finish();
    await vi.waitFor(() =>
      expect(cache.getPreparationState()).toMatchObject({
        phase: "degraded",
        cached: 1,
        failed: 1,
      }),
    );
    cache.prefetch([547, 556], client);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(client.runRecords).toHaveBeenCalledTimes(1);
  });
});
