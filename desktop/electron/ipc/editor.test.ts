// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PythonClientError } = require("../../dist-electron/python/client.cjs");
const { getRunState, listMaps, listUpgrades } = require("../../dist-electron/ipc/editor.cjs");

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

const saveId = "REPO_SAVE_2026_08_08_10_20_30";

describe("editor data IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects invalid save IDs before starting Python", async () => {
    const fake = client({});
    await expect(listUpgrades(fake, "C:\\save.es3")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    await expect(getRunState(fake, "../save")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("parses dynamic known and unknown upgrades", async () => {
    const response = {
      ok: true,
      upgrades: [
        {
          key: "playerUpgradeStrength",
          label: "Strength",
          known: true,
          values: [{ playerId: "111", value: 2 }],
        },
        {
          key: "playerUpgradeMoonBoots",
          label: "Moon Boots",
          known: false,
          values: [{ playerId: "111", value: 7 }],
        },
      ],
    };
    await expect(listUpgrades(client(response), saveId)).resolves.toEqual({
      ok: true,
      data: response.upgrades,
    });
  });

  it("parses friendly run values and unknown resume options", async () => {
    const run = {
      stats: [
        { key: "level", label: "Level", value: 5 },
        { key: "currency", label: "Currency", value: 12 },
      ],
      resumeLocation: {
        value: "Unknown (9)",
        options: ["Normal", "Shop / Service Station", "Unknown (9)"],
      },
    };
    await expect(getRunState(client({ ok: true, run }), saveId)).resolves.toEqual({
      ok: true,
      data: run,
    });
  });

  it("parses available and unavailable map discovery", async () => {
    await expect(
      listMaps(
        client({
          ok: true,
          available: true,
          catalogPath: "C:\\game\\catalog.json",
          maps: [
            {
              internalName: "Arctic",
              displayName: "McJannek Station",
              knownLabel: true,
            },
          ],
        }),
      ),
    ).resolves.toMatchObject({ ok: true, data: { available: true } });
    await expect(
      listMaps(client({ ok: true, available: false, catalogPath: null, maps: [] })),
    ).resolves.toEqual({
      ok: true,
      data: { available: false, catalogPath: null, maps: [] },
    });
  });

  it("normalizes feature errors and malformed responses", async () => {
    await expect(
      listMaps(
        client({
          ok: false,
          error: { code: "backend_unavailable", message: "Map metadata failed." },
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "backend_unavailable" } });
    await expect(
      listUpgrades(client({ ok: true, upgrades: [{ key: "bad" }] }), saveId),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });

    const fake = client({});
    vi.mocked(fake.run).mockRejectedValue(new PythonClientError("process_timeout", "private"));
    await expect(getRunState(fake, saveId)).resolves.toEqual({
      ok: false,
      error: { code: "process_timeout", message: "The Python run service timed out." },
    });
  });
});
