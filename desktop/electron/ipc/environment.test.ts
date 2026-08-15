// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { detectEnvironment } = require("../../dist-electron/ipc/environment.cjs");

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

const unavailable = {
  ok: true,
  saveRoot: null,
  saveRootStatus: "unavailable",
  saveRootDetected: false,
  saveCount: 0,
  skippedSaveEntries: 0,
  saves: [],
  gameStatus: "game_not_found",
  gameDetected: false,
  gameRoot: null,
  gameCatalogPath: null,
  steamLibraryRoots: ["D:\\private\\SteamLibrary"],
  gameDiscoveryIssues: [],
};

describe("environment IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("accepts explicit unavailable local-data state without exposing new discovery paths", async () => {
    await expect(detectEnvironment(client(unavailable))).resolves.toEqual({
      ok: true,
      data: {
        saveRoot: null,
        saveRootStatus: "unavailable",
        saveRootDetected: false,
        gameRoot: null,
        gameStatus: "game_not_found",
        gameDetected: false,
        saves: [],
      },
    });
  });

  it("rejects inconsistent nullable save-root states", async () => {
    for (const response of [
      { ...unavailable, saveRoot: "C:\\guessed\\saves" },
      { ...unavailable, saveRootStatus: "missing" },
    ]) {
      await expect(detectEnvironment(client(response))).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_response" },
      });
    }
  });
});
