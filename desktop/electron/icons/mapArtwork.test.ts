// @vitest-environment node
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { SpriteArtworkStore } = require("../../dist-electron/icons/spriteArtworkStore.cjs");
const { MapArtwork } = require("../../dist-electron/icons/mapArtwork.cjs");
const { LocalIconRegistry } = require("../../dist-electron/icons/registry.cjs");
const { serveLocalIcon } = require("../../dist-electron/icons/protocol.cjs");
const { listMaps } = require("../../dist-electron/ipc/maps.cjs");
// Synthetic single pixel, never an extracted game fixture.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQVTL/DwACLAFukU/9kgAAAABJRU5ErkJggg==",
  "base64",
);
const revision = "a".repeat(64);
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repoditor-maps-"));
  homes.push(root);
  const source = path.join(root, "source");
  await fs.writeFile(source, "original");
  const stat = await fs.lstat(source, { bigint: true });
  const artwork = {
    sourceIdentity: revision,
    pngBase64: png.toString("base64"),
    width: 1,
    height: 1,
    watches: [{ path: source, size: String(stat.size), mtimeNs: String(stat.mtimeNs) }],
  };
  const client = {
    run: vi.fn().mockResolvedValue({ ok: true, artworks: { Desert: artwork, Future: artwork } }),
    dispose: vi.fn(),
  };
  const cacheRoot = path.join(root, "cache");
  const cache = new MapArtwork();
  cache.configurePersistentRoot(cacheRoot);
  return { root, source, artwork, client, cacheRoot, cache };
}

describe("installed-map artwork source", () => {
  it("deduplicates cold batches and reuses memory and disk across navigation and relaunch", async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.cache.get("Desert", revision, f.client),
      f.cache.get("Future", revision, f.client),
    ]);
    expect(results).toEqual([png, png]);
    expect(f.client.run).toHaveBeenCalledExactlyOnceWith("maps-artwork");
    expect(await f.cache.get("Desert", revision, f.client)).toEqual(png);
    const relaunched = new MapArtwork();
    relaunched.configurePersistentRoot(f.cacheRoot);
    expect(await relaunched.get("Future", revision, f.client)).toEqual(png);
    expect(f.client.run).toHaveBeenCalledTimes(1);
  });

  it("invalidates source changes and rejects old revisions even when the cached PNG is intact", async () => {
    const f = await fixture();
    await f.cache.get("Desert", revision, f.client);
    await fs.writeFile(f.source, "changed source");
    expect(await f.cache.get("Desert", revision, f.client)).toBeNull();
    const stat = await fs.lstat(f.source, { bigint: true });
    const next = "b".repeat(64);
    f.artwork.sourceIdentity = next;
    f.artwork.watches[0] = {
      path: f.source,
      size: String(stat.size),
      mtimeNs: String(stat.mtimeNs),
    };
    expect(await f.cache.get("Desert", next, f.client)).toEqual(png);
    expect(await f.cache.get("Desert", revision, f.client)).toBeNull();
    expect((await fs.readdir(f.cacheRoot)).filter((n) => n.endsWith(".png"))).toHaveLength(2);
    expect((await fs.readdir(f.cacheRoot)).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("rejects corrupt disk images and source junctions", async () => {
    const f = await fixture();
    await f.cache.get("Desert", revision, f.client);
    const manifest = JSON.parse(await fs.readFile(path.join(f.cacheRoot, "manifest.json"), "utf8"));
    manifest.entries.Desert.pngHash = "0".repeat(64);
    await fs.writeFile(path.join(f.cacheRoot, "manifest.json"), JSON.stringify(manifest));
    const relaunched = new MapArtwork();
    relaunched.configurePersistentRoot(f.cacheRoot);
    const unavailable = {
      run: vi.fn().mockRejectedValue(new Error("unavailable")),
      dispose: vi.fn(),
    };
    expect(await relaunched.get("Desert", revision, unavailable)).toBeNull();
    const linked = path.join(f.root, "linked");
    await fs.symlink(f.cacheRoot, linked, "junction");
    f.artwork.watches = [{ path: path.join(linked, "manifest.json"), size: "1", mtimeNs: "1" }];
    f.cache.refresh();
    expect(await f.cache.get("Future", "c".repeat(64), f.client)).toBeNull();
  });

  it("fails soft once per revision, and retries only on catalog refresh", async () => {
    const f = await fixture();
    f.client.run.mockRejectedValue(new Error("backend unavailable"));
    expect(await f.cache.get("Desert", revision, f.client)).toBeNull();
    expect(await f.cache.get("Future", revision, f.client)).toBeNull();
    expect(f.client.run).toHaveBeenCalledTimes(1);
    f.cache.refresh();
    expect(await f.cache.get("Desert", revision, f.client)).toBeNull();
    expect(f.client.run).toHaveBeenCalledTimes(2);
  });

  it.each(["../Desert", "a/b", "a\\b", "", "a".repeat(65)])(
    "rejects unsafe identities %s",
    async (family) => {
      const f = await fixture();
      expect(await f.cache.get(family, revision, f.client)).toBeNull();
      expect(f.client.run).not.toHaveBeenCalled();
    },
  );

  it("uses the existing opaque GET-only protocol with source-bound map registrations", async () => {
    const f = await fixture();
    const registry = new LocalIconRegistry();
    const request = {
      cacheKey: null,
      upgradeKey: null,
      mapFamily: "Desert",
      sourceIdentity: revision,
    };
    const [token] = registry.replaceVisuals("map", [request]);
    expect(registry.replaceVisuals("map", [request])).toEqual([token]);
    const serve = (url: string, method = "GET") =>
      serveLocalIcon(
        new Request(url, { method }),
        null,
        registry,
        f.client,
        undefined,
        undefined,
        undefined,
        f.cache,
      );
    const url = `repoditor-icon://local/${token}`;
    const response = await serve(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect((await serve(url, "POST")).status).toBe(405);
    for (const bad of [
      url + "?path=secret",
      url + "/extra",
      url.replace("repoditor-icon:", "https:"),
      url.replace("local/", "evil/"),
    ])
      expect((await serve(bad)).status).toBe(404);
    expect(() => registry.replaceVisuals("item", [request])).toThrow("namespace");
    const [updated] = registry.replaceVisuals("map", [
      { ...request, sourceIdentity: "b".repeat(64) },
    ]);
    expect(updated).not.toBe(token);
    expect((await serve(url)).status).toBe(404);
  });

  it("validates map IPC identities and exposes only opaque tokens for previews", async () => {
    const run = vi.fn().mockResolvedValue({
      ok: true,
      available: true,
      catalogPath: "C:/fixture/level0",
      maps: [
        {
          internalName: "Future",
          displayName: "Authored future name",
          knownLabel: true,
          artworkRevision: revision,
        },
      ],
    });
    const result = await listMaps({ run, dispose: vi.fn() });
    expect(result).toMatchObject({
      ok: true,
      data: { maps: [{ internalName: "Future", iconToken: expect.any(String) }] },
    });
    expect(JSON.stringify(result)).not.toContain(revision);
    run.mockResolvedValue({
      ok: true,
      available: true,
      catalogPath: "C:/fixture",
      maps: [{ internalName: "../outside", displayName: "Bad", knownLabel: false }],
    });
    expect(await listMaps({ run, dispose: vi.fn() })).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
  });
  it("does not start an obsolete overlapping batch when the catalog refreshes during cache I/O", async () => {
    const f = await fixture();
    const oldResponse = structuredClone({
      ok: true,
      artworks: { Desert: f.artwork, Future: f.artwork },
    });
    let finishOld!: (value: unknown) => void;
    let finishNew!: (value: unknown) => void;
    let releaseCache!: () => void;
    const oldBatch = new Promise((resolve) => {
      finishOld = resolve;
    });
    const newBatch = new Promise((resolve) => {
      finishNew = resolve;
    });
    const cacheGate = new Promise<void>((resolve) => {
      releaseCache = resolve;
    });
    f.client.run.mockImplementationOnce(() => oldBatch).mockImplementationOnce(() => newBatch);
    const first = f.cache.get("Desert", revision, f.client);
    await vi.waitFor(() => expect(f.client.run).toHaveBeenCalledTimes(1));
    const original = SpriteArtworkStore.prototype.fromMemory;
    const delayed = vi
      .spyOn(SpriteArtworkStore.prototype, "fromMemory")
      .mockImplementation(async function (this: object, ...arguments_: unknown[]) {
        const [family, identity] = arguments_;
        if (family === "Future" && identity === revision) await cacheGate;
        return Reflect.apply(original, this, arguments_);
      });
    const obsolete = f.cache.get("Future", revision, f.client);
    const next = "b".repeat(64);
    await fs.writeFile(f.source, "changed installed source");
    const stat = await fs.lstat(f.source, { bigint: true });
    const artwork = {
      ...f.artwork,
      sourceIdentity: next,
      watches: [{ path: f.source, size: String(stat.size), mtimeNs: String(stat.mtimeNs) }],
    };
    const response = { ok: true, artworks: { Desert: artwork, Future: artwork } };
    f.client.run.mockResolvedValue(response);
    f.cache.refresh();
    const current = f.cache.get("Future", next, f.client);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      releaseCache();
      await new Promise<void>((resolve) => setImmediate(resolve));
      finishOld(oldResponse);
      expect(await first).toBeNull();
      expect(await obsolete).toBeNull();
      expect(f.client.run).toHaveBeenCalledTimes(2);
      finishNew(response);
      expect(await current).toEqual(png);
    } finally {
      releaseCache();
      finishOld(oldResponse);
      finishNew(response);
      delayed.mockRestore();
      await Promise.allSettled([first, obsolete, current]);
    }
  });
});
