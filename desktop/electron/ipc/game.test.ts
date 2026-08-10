// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PythonClientError } = require("../../dist-electron/python/client.cjs");
const { getGameStatus } = require("../../dist-electron/ipc/game.cjs");

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

describe("game-status IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("returns only the narrow typed game state", async () => {
    const fake = client({
      ok: true,
      status: "running",
      running: true,
      processes: [{ pid: 123, path: "C:\\private\\REPO.exe" }],
    });

    await expect(getGameStatus(fake)).resolves.toEqual({
      ok: true,
      data: { status: "running", running: true },
    });
    expect(fake.run).toHaveBeenCalledWith("game-status");
  });

  it("rejects malformed or inconsistent status responses", async () => {
    for (const response of [
      { ok: true, status: "maybe", running: false },
      { ok: true, status: "running", running: false },
      { ok: true, status: "not_running", running: true },
      { ok: true, status: "unknown" },
    ]) {
      await expect(getGameStatus(client(response))).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_response" },
      });
    }
  });

  it("normalizes Python process failures", async () => {
    const fake = client({});
    vi.mocked(fake.run).mockRejectedValue(new PythonClientError("process_timeout", "private"));

    await expect(getGameStatus(fake)).resolves.toEqual({
      ok: false,
      error: {
        code: "process_timeout",
        message: "The Python game-status service timed out.",
      },
    });
  });
});
