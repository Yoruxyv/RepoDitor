// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CosmeticDto, CosmeticsViewDto } from "../contracts.cjs";

const require = createRequire(import.meta.url);
const { getCosmetics, saveCosmetics } = require("../../dist-electron/ipc/cosmetics.cjs");

const fingerprint = "a".repeat(64);
const unknownReason =
  "Cosmetic ID is absent from the installed catalog and is preserved read-only.";
const futureReason =
  "Cosmetic ID is outside the proven mutation trust boundary and is preserved read-only.";

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

function installedDisplayName(id: number): string {
  if (id < 2) {
    return "Duplicate Name";
  }
  if (id === 2) {
    return "Monkey";
  }
  return `Installed ${id}`;
}

function installedCosmetic(id: number, owned = id === 1): CosmeticDto & { iconKey: null } {
  const mutationEligible = id < 547;
  return {
    id,
    displayName: installedDisplayName(id),
    type: id % 4,
    rarity: id % 3,
    status: 1,
    owned,
    known: true,
    state: owned ? "owned" : "locked",
    mutationEligible,
    removalBlockedReason: mutationEligible ? null : futureReason,
    iconToken: null,
    iconKey: null,
  };
}

function unknownCosmetic(id: number): CosmeticDto & { iconKey: null } {
  return {
    id,
    displayName: `Cosmetic #${id}`,
    type: null,
    rarity: null,
    status: null,
    owned: true,
    known: false,
    state: "unknown",
    mutationEligible: false,
    removalBlockedReason: unknownReason,
    iconToken: null,
    iconKey: null,
  };
}

function view(count = 3): CosmeticsViewDto {
  const cosmetics = Array.from({ length: count }, (_, id) => installedCosmetic(id));
  cosmetics.push(unknownCosmetic(999));
  const knownOwnedCount = cosmetics.filter((cosmetic) => cosmetic.known && cosmetic.owned).length;
  return {
    fingerprint,
    catalogAvailable: true,
    knownCatalogCount: count,
    knownOwnedCount,
    knownLockedCount: count - knownOwnedCount,
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

function degradedView(): CosmeticsViewDto {
  return {
    fingerprint,
    catalogAvailable: false,
    knownCatalogCount: 0,
    knownOwnedCount: 0,
    knownLockedCount: 0,
    savedPresetCount: 0,
    unknownOwnedIds: [27, 999],
    capabilities: {
      canReadCosmetics: true,
      canUnlockCosmetic: false,
      canUnlockAll: false,
      canRemoveOwnership: false,
    },
    cosmetics: [unknownCosmetic(27), unknownCosmetic(999)],
  };
}

describe("cosmetics IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("round-trips dynamic metadata and preserves duplicate names by integer ID", async () => {
    const response = { ...view(), rawMetaSave: { cosmeticTokens: [7] } };
    Object.assign(response.cosmetics[0], { iconKey: "cosmetic-object.png" });
    const fake = client({ ok: true, cosmetics: response });
    const result = await getCosmetics(fake);

    expect(fake.run).toHaveBeenCalledWith("cosmetics-get");
    expect(result).toMatchObject({
      ok: true,
      data: {
        catalogAvailable: true,
        knownCatalogCount: 3,
        knownOwnedCount: 1,
        knownLockedCount: 2,
        unknownOwnedIds: [999],
      },
    });
    expect(result.data.cosmetics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 0,
          displayName: "Duplicate Name",
          type: 0,
          rarity: 0,
          status: 1,
        }),
        expect.objectContaining({
          id: 1,
          displayName: "Duplicate Name",
          type: 1,
          rarity: 1,
          status: 1,
        }),
      ]),
    );
    const duplicateCosmetics = result.data.cosmetics as CosmeticDto[];
    const duplicateIds = duplicateCosmetics
      .filter((cosmetic) => cosmetic.displayName === "Duplicate Name")
      .map((cosmetic) => cosmetic.id)
      .sort((left, right) => left - right);
    expect(duplicateIds).toEqual([0, 1]);
    expect(result.data).not.toHaveProperty("rawMetaSave");
    expect(result.data.cosmetics[0]).not.toHaveProperty("iconKey");
    expect(result.data.cosmetics[0].iconToken).toMatch(/^[\da-f-]{36}$/);
  });

  it("accepts an explicit degraded catalog without fabricating installed metadata", async () => {
    const result = await getCosmetics(client({ ok: true, cosmetics: degradedView() }));

    expect(result).toMatchObject({
      ok: true,
      data: { ...degradedView(), cosmetics: expect.any(Array) },
    });
    expect(result.data.cosmetics[0]).not.toHaveProperty("iconKey");
    expect(result.data.cosmetics[0]).toMatchObject({
      id: 27,
      type: null,
      rarity: null,
      status: null,
      state: "unknown",
      mutationEligible: false,
    });
  });

  it("accepts installed future IDs as read-only presentation metadata", async () => {
    const futureView = view(548);
    futureView.cosmetics[547]!.displayName = "Future Cosmetic";

    const result = await getCosmetics(client({ ok: true, cosmetics: futureView }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        knownCatalogCount: 548,
        cosmetics: expect.arrayContaining([
          expect.objectContaining({
            id: 547,
            displayName: "Future Cosmetic",
            mutationEligible: false,
            state: "locked",
          }),
        ]),
      },
    });
  });

  it("passes only canonical proven ownership changes to Python", async () => {
    const updated = view();
    updated.knownOwnedCount = 2;
    updated.knownLockedCount = 1;
    updated.cosmetics[2]!.owned = true;
    updated.cosmetics[2]!.state = "owned";
    const fake = client({
      ok: true,
      result: { backupPath: "C:\\fixture\\MetaSave.es3.bak-1", cosmetics: updated },
    });
    const changes = [{ feature: "cosmetics", entity: "2", field: "owned", after: true }];

    await expect(saveCosmetics(fake, fingerprint, changes)).resolves.toMatchObject({
      ok: true,
      data: { backupPath: "C:\\fixture\\MetaSave.es3.bak-1" },
    });
    expect(fake.run).toHaveBeenCalledWith("cosmetics-write", [
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

    await saveCosmetics(fake, fingerprint, [change]);

    expect(fake.run).toHaveBeenCalledWith("cosmetics-write", [
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

    await saveCosmetics(fake, fingerprint, [change]);

    expect(fake.run).toHaveBeenCalledWith("cosmetics-write", [
      fingerprint,
      JSON.stringify([change]),
    ]);
  });

  it("accepts one typed Clear All Presets action", async () => {
    const updated = view();
    updated.savedPresetCount = 0;
    const fake = client({
      ok: true,
      result: { backupPath: "C:\\fixture\\MetaSave.es3.bak-1", cosmetics: updated },
    });
    const change = {
      feature: "cosmetics",
      entity: "presets",
      field: "clearAll",
      after: true,
    };

    await saveCosmetics(fake, fingerprint, [change]);

    expect(fake.run).toHaveBeenCalledWith("cosmetics-write", [
      fingerprint,
      JSON.stringify([change]),
    ]);
  });

  it("rejects malformed output and mutation requests outside the proven boundary", async () => {
    const fake = client({});
    await expect(getCosmetics(fake)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
    for (const changes of [
      [{ feature: "cosmetics", entity: "547", field: "owned", after: true }],
      [{ feature: "cosmetics", entity: "002", field: "owned", after: true }],
      [{ feature: "cosmetics", entity: "Duplicate Name", field: "owned", after: true }],
      [{ feature: "cosmetics", entity: "2", field: "tokens", after: 99 }],
      [
        { feature: "cosmetics", entity: "2", field: "owned", after: true },
        { feature: "cosmetics", entity: "2", field: "owned", after: false },
      ],
      [
        { feature: "cosmetics", entity: "known", field: "unlockAll", after: true },
        { feature: "cosmetics", entity: "2", field: "owned", after: false },
      ],
    ]) {
      await expect(saveCosmetics(fake, fingerprint, changes)).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    fake.run.mockClear();
    expect(fake.run).not.toHaveBeenCalled();

    const wrongAvailability = view();
    wrongAvailability.catalogAvailable = false;
    await expect(
      getCosmetics(client({ ok: true, cosmetics: wrongAvailability })),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });

    const fabricatedUnknown = degradedView();
    fabricatedUnknown.cosmetics[0]!.type = 7;
    await expect(
      getCosmetics(client({ ok: true, cosmetics: fabricatedUnknown })),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });

    const writableFuture = view(548);
    writableFuture.cosmetics[547]!.mutationEligible = true;
    writableFuture.cosmetics[547]!.removalBlockedReason = null;
    await expect(
      getCosmetics(client({ ok: true, cosmetics: writableFuture })),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });

    const traversal = view();
    Object.assign(traversal.cosmetics[0], { iconKey: "../secret.png" });
    await expect(getCosmetics(client({ ok: true, cosmetics: traversal }))).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
  });

  it("passes through supported MetaSave failures", async () => {
    await expect(
      saveCosmetics(
        client({
          ok: false,
          error: { code: "game_running", message: "Close R.E.P.O. before saving." },
        }),
        fingerprint,
        [{ feature: "cosmetics", entity: "known", field: "unlockAll", after: true }],
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "game_running", message: "Close R.E.P.O. before saving." },
    });

    await expect(
      getCosmetics(
        client({ ok: false, error: { code: "meta_missing", message: "MetaSave missing." } }),
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "meta_missing", message: "MetaSave missing." },
    });
  });
});
