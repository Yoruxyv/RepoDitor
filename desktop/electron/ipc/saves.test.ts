// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PythonClientError } = require("../../dist-electron/python/client.cjs");
const { openSave } = require("../../dist-electron/ipc/saves.cjs");

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

const session = {
  id: "REPO_SAVE_2026_08_08_10_20_30",
  displayName: "2026-08-08 10:20:30",
  path: "C:\\fixture\\save.es3",
  lastModified: "2026-08-08T10:20:30+00:00",
  level: 5,
  currency: 12,
  playerCount: 2,
  resumeLocation: "Normal",
};

describe("openSave", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects invalid IDs before starting Python", async () => {
    const fake = client({});
    await expect(openSave(fake, "C:\\real-save.es3")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("parses the typed open contract", async () => {
    const fake = client({ ok: true, session });
    await expect(openSave(fake, session.id)).resolves.toEqual({
      ok: true,
      data: {
        id: session.id,
        name: session.displayName,
        path: session.path,
        modifiedAt: session.lastModified,
        level: session.level,
        currency: session.currency,
        playerCount: session.playerCount,
        resumeLocation: session.resumeLocation,
      },
    });
    expect(fake.run).toHaveBeenCalledWith("saves-open", [session.id]);
  });

  it("normalizes invalid protocol data", async () => {
    await expect(openSave(client({ ok: true, session: { ...session, level: "5" } }), session.id))
      .resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("rejects a session for a different save ID", async () => {
    await expect(
      openSave(client({ ok: true, session: { ...session, id: "REPO_SAVE_2026_08_08_10_20_31" } }), session.id),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("passes through stable domain failures", async () => {
    await expect(
      openSave(
        client({
          ok: false,
          error: { code: "save_corrupt", message: "The selected save is corrupted." },
        }),
        session.id,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "save_corrupt", message: "The selected save is corrupted." },
    });
  });

  it("normalizes Python process failures", async () => {
    const fake = client({});
    vi.mocked(fake.run).mockRejectedValue(new PythonClientError("process_timeout", "private"));
    await expect(openSave(fake, session.id)).resolves.toEqual({
      ok: false,
      error: { code: "process_timeout", message: "The Python save service timed out." },
    });
  });
});
