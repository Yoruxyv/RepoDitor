// @vitest-environment node

import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { buildPythonArguments } = require("../../dist-electron/python/client.cjs");

describe("Python asset preparation transport", () => {
  it("keeps the bounded batch request out of process argv", () => {
    expect(buildPythonArguments("assets-prepare", [], true)).toEqual(["assets-prepare"]);
    expect(buildPythonArguments("assets-prepare", [], false)).toEqual([
      "-m",
      "repo_save_editor.desktop_api",
      "assets-prepare",
    ]);
    expect(() => buildPythonArguments("assets-prepare", ['["playerUpgradeHealth"]'], true)).toThrow(
      /stdin/,
    );
  });

  it("keeps ordinary commands on their existing argv transport", () => {
    expect(buildPythonArguments("upgrades-list", ["save-id"], true)).toEqual([
      "upgrades-list",
      "save-id",
    ]);
  });
});

function transport() {
  const stream = () => Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const child = Object.assign(new EventEmitter(), {
    stdout: stream(),
    stderr: stream(),
    kill: vi.fn(),
  });
  const spawn = vi.spyOn(require("node:child_process"), "spawn").mockReturnValue(child);
  const modulePath = require.resolve("../../dist-electron/python/client.cjs");
  delete require.cache[modulePath];
  const electronModule = require.cache[require.resolve("electron")]!;
  const original = electronModule.exports;
  electronModule.exports = { app: { isPackaged: false } };
  try {
    return { client: require(modulePath).pythonClient, child, spawn };
  } finally {
    electronModule.exports = original;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("finite map batch process lifetime", () => {
  it("allows bounded map output and closes a successful child", async () => {
    const { client, child, spawn } = transport();
    const pending = client.run("maps-artwork");
    child.stdout.emit("data", JSON.stringify({ ok: true, artworks: {} }));
    child.emit("close", 0);
    await expect(pending).resolves.toEqual({ ok: true, artworks: {} });
    expect(spawn.mock.calls[0][2]).toMatchObject({
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    client.dispose();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("kills a stalled batch at its finite deadline", async () => {
    vi.useFakeTimers();
    const { client, child } = transport();
    const pending = client.run("maps-artwork");
    const result = expect(pending).rejects.toMatchObject({ code: "process_timeout" });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(child.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);
    client.dispose();
  });

  it("kills excess output and releases outstanding work on application disposal", async () => {
    const { client, child } = transport();
    const pending = client.run("maps-artwork");
    const oversized = expect(pending).rejects.toMatchObject({ code: "malformed_response" });
    child.stdout.emit("data", "x".repeat(16 * 1024 * 1024 + 1));
    await oversized;
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit("close", null);
    const cancelled = client.run("maps-artwork");
    const closed = expect(cancelled).rejects.toMatchObject({ code: "process_failed" });
    client.dispose();
    child.emit("close", null);
    await closed;
    await expect(client.run("maps-artwork")).rejects.toMatchObject({ code: "process_failed" });
  });
});
