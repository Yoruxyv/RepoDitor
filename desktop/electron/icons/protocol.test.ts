// @vitest-environment node

import { createRequire } from "node:module";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { LocalIconRegistry, readIconKey } = require("../../dist-electron/icons/registry.cjs");
const { serveLocalIcon } = require("../../dist-electron/icons/protocol.cjs");

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
  const roots = { item: path.join(base, "Items"), cosmetic: path.join(base, "Cosmetics") };
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
    const second = registry.replace("cosmetic", ["kept.png", "added.png"]);

    expect(second.get("kept.png")).toBe(first.get("kept.png"));
    expect(second.get("added.png")).not.toBe(first.get("removed.png"));
    expect(registry.get(first.get("removed.png"))).toBeUndefined();
    expect(registry.get(item.get("kept.png"))).toEqual({ domain: "item", key: "kept.png" });
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
    expect((await serveLocalIcon(new Request(`repoditor-icon://local/${wide}`, { method: "POST" }), roots, registry)).status).toBe(405);
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
});
