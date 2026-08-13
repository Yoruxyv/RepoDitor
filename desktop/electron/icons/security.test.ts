// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("local icon security boundary", () => {
  it("keeps the renderer sandbox and permits only the narrow icon CSP source", async () => {
    const main = await readFile(path.resolve("electron/main.cts"), "utf8");
    const preload = await readFile(path.resolve("electron/preload.cts"), "utf8");
    const html = await readFile(path.resolve("index.html"), "utf8");

    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
    expect(preload).not.toMatch(/readFile|filesystem|repoditor-icon/);
    expect(html).toMatch(/img-src[^;]*repoditor-icon:/);
    expect(html).not.toMatch(/img-src[^;]*(?:file:|\*)/);
  });
});
