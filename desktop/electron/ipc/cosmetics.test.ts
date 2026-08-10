// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CosmeticDto } from "../contracts.cjs";

const require = createRequire(import.meta.url);
const { getCosmetics, saveCosmetics } = require("../../dist-electron/ipc/cosmetics.cjs");

const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const fingerprint = "a".repeat(64);

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

function view() {
  const cosmetics: CosmeticDto[] = Array.from({ length: 547 }, (_, id) => ({
    id,
    displayName: `Cosmetic #${id}`,
    owned: id === 27,
    known: true,
    removalBlockedReason: null,
  }));
  cosmetics.push({
    id: 999,
    displayName: "Cosmetic #999",
    owned: true,
    known: false,
    removalBlockedReason: "Unknown or future cosmetics are preserved read-only.",
  });
  return {
    fingerprint,
    knownCatalogCount: 547,
    knownOwnedCount: 1,
    knownLockedCount: 546,
    savedPresetCount: 0,
    unknownOwnedIds: [999],
    capabilities: {
      canReadCosmetics: true,
      canUnlockCosmetic: true,
      canUnlockAll: true,
      canRemoveOwnership: true,
    },
    cosmetics,
  };
}

describe("cosmetics IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("parses the narrow catalog projection without raw MetaSave data", async () => {
    const response = { ...view(), rawMetaSave: { cosmeticTokens: [7] } };
    const result = await getCosmetics(client({ ok: true, cosmetics: response }), saveId);

    expect(result).toMatchObject({
      ok: true,
      data: { knownCatalogCount: 547, unknownOwnedIds: [999] },
    });
    expect(result.data).not.toHaveProperty("rawMetaSave");
  });

  it("passes only exact known ownership changes to Python", async () => {
    const updated = view();
    updated.knownOwnedCount = 2;
    updated.knownLockedCount = 545;
    updated.cosmetics[28]!.owned = true;
    const fake = client({
      ok: true,
      result: { backupPath: "C:\\fixture\\MetaSave.es3.bak-1", cosmetics: updated },
    });
    const changes = [
      { feature: "cosmetics", entity: "28", field: "owned", after: true },
    ];

    await expect(saveCosmetics(fake, saveId, fingerprint, changes)).resolves.toMatchObject({
      ok: true,
      data: { backupPath: "C:\\fixture\\MetaSave.es3.bak-1" },
    });
    expect(fake.run).toHaveBeenCalledWith("cosmetics-write", [
      saveId,
      fingerprint,
      JSON.stringify(changes),
    ]);
  });

  it("accepts one typed Unlock All action", async () => {
    const fake = client({
      ok: true,
      result: { backupPath: "C:\\fixture\\MetaSave.es3.bak-1", cosmetics: view() },
    });
    const change = {
      feature: "cosmetics",
      entity: "known",
      field: "unlockAll",
      after: true,
    };

    await saveCosmetics(fake, saveId, fingerprint, [change]);

    expect(fake.run).toHaveBeenCalledWith("cosmetics-write", [
      saveId,
      fingerprint,
      JSON.stringify([change]),
    ]);
  });

  it("accepts one typed Lock All action", async () => {
    const fake = client({
      ok: true,
      result: { backupPath: "C:\\fixture\\MetaSave.es3.bak-1", cosmetics: view() },
    });
    const change = {
      feature: "cosmetics",
      entity: "known",
      field: "lockAll",
      after: false,
    };

    await saveCosmetics(fake, saveId, fingerprint, [change]);

    expect(fake.run).toHaveBeenCalledWith("cosmetics-write", [
      saveId,
      fingerprint,
      JSON.stringify([change]),
    ]);
  });

  it("rejects paths, unknown IDs, arbitrary fields, duplicates, and malformed output", async () => {
    const fake = client({});
    await expect(getCosmetics(fake, "C:\\MetaSave.es3")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    for (const changes of [
      [{ feature: "cosmetics", entity: "999", field: "owned", after: true }],
      [{ feature: "cosmetics", entity: "28", field: "tokens", after: 99 }],
      [
        { feature: "cosmetics", entity: "28", field: "owned", after: true },
        { feature: "cosmetics", entity: "28", field: "owned", after: false },
      ],
      [
        { feature: "cosmetics", entity: "known", field: "unlockAll", after: true },
        { feature: "cosmetics", entity: "28", field: "owned", after: false },
      ],
    ]) {
      await expect(saveCosmetics(fake, saveId, fingerprint, changes)).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(fake.run).not.toHaveBeenCalled();

    const malformed = view();
    malformed.knownLockedCount = 547;
    await expect(getCosmetics(client({ ok: true, cosmetics: malformed }), saveId)).resolves
      .toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("passes through supported MetaSave failures", async () => {
    await expect(
      getCosmetics(
        client({ ok: false, error: { code: "meta_missing", message: "MetaSave missing." } }),
        saveId,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "meta_missing", message: "MetaSave missing." },
    });
  });
});
