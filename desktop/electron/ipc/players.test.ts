// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PythonClientError } = require("../../dist-electron/python/client.cjs");
const { getPlayerAvatar, listPlayers } = require("../../dist-electron/ipc/players.cjs");

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

const saveId = "REPO_SAVE_2026_08_08_10_20_30";

describe("player IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects invalid input before starting Python", async () => {
    const fake = client({});
    await expect(listPlayers(fake, "C:\\real-save.es3")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    await expect(getPlayerAvatar(fake, saveId, "../111")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("parses friendly player DTOs", async () => {
    const fake = client({
      ok: true,
      players: [
        { id: "111", name: "Alpha", health: 80 },
        { id: "222", name: "Beta", health: 0 },
      ],
    });
    await expect(listPlayers(fake, saveId)).resolves.toEqual({
      ok: true,
      data: [
        { id: "111", name: "Alpha", health: 80 },
        { id: "222", name: "Beta", health: 0 },
      ],
    });
    expect(fake.run).toHaveBeenCalledWith("players-list", [saveId]);
  });

  it("rejects malformed player DTOs", async () => {
    await expect(
      listPlayers(client({ ok: true, players: [{ id: "111", name: "Alpha", health: -1 }] }), saveId),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("allows only a matching safe avatar contract", async () => {
    const avatarUrl = "https://avatars.akamai.steamstatic.com/avatar.jpg";
    await expect(
      getPlayerAvatar(
        client({ ok: true, avatar: { playerId: "111", avatarUrl } }),
        saveId,
        "111",
      ),
    ).resolves.toEqual({ ok: true, data: { playerId: "111", avatarUrl } });

    await expect(
      getPlayerAvatar(
        client({
          ok: true,
          avatar: { playerId: "111", avatarUrl: "https://example.com/avatar.jpg" },
        }),
        saveId,
        "111",
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
    await expect(
      getPlayerAvatar(
        client({ ok: true, avatar: { playerId: "222", avatarUrl: null } }),
        saveId,
        "111",
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("normalizes process failures", async () => {
    const fake = client({});
    vi.mocked(fake.run).mockRejectedValue(new PythonClientError("process_timeout", "private"));
    await expect(listPlayers(fake, saveId)).resolves.toEqual({
      ok: false,
      error: { code: "process_timeout", message: "The Python player service timed out." },
    });
  });
});
