// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CosmeticDto, CosmeticsViewDto } from "../contracts.cjs";

const require = createRequire(import.meta.url);
const { getCosmetics, saveCosmetics } = require("../../dist-electron/ipc/cosmetics.cjs");
const { PROVEN_COSMETIC_IDS } = require("../../dist-electron/ipc/known-cosmetics.cjs") as {
  PROVEN_COSMETIC_IDS: ReadonlySet<number>;
};
const FUTURE_COSMETIC_ID =
  [...PROVEN_COSMETIC_IDS].reduce((highest, id) => Math.max(highest, id), -1) + 1;

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

function installedCosmetic(
  id: number,
  owned = id === 1,
  mutationEligible = PROVEN_COSMETIC_IDS.has(id),
): CosmeticDto & { iconKey: null } {
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
      canClearPresets: true,
    },
    cosmetics,
  };
}

function installedCosmeticAt(viewValue: CosmeticsViewDto, id: number): CosmeticDto {
  const cosmetic = viewValue.cosmetics.find((candidate) => candidate.id === id);
  if (!cosmetic?.known) {
    throw new Error(`Missing installed cosmetic ${id}.`);
  }
  return cosmetic;
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
      canClearPresets: true,
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

  it("accepts recognized metadata with explicitly denied mutation capabilities", async () => {
    const readonlyView = view();
    readonlyView.capabilities.canUnlockCosmetic = false;
    readonlyView.capabilities.canUnlockAll = false;
    readonlyView.capabilities.canRemoveOwnership = false;
    readonlyView.capabilities.canClearPresets = false;
    for (const cosmetic of readonlyView.cosmetics) {
      cosmetic.mutationEligible = false;
      cosmetic.removalBlockedReason = "Installed build is not approved for mutation";
    }
    const result = await getCosmetics(client({ ok: true, cosmetics: readonlyView }));
    expect(result.ok).toBe(true);
    expect(result.data.knownCatalogCount).toBe(3);
    expect(result.data.cosmetics.every((cosmetic: CosmeticDto) => !cosmetic.mutationEligible)).toBe(
      true,
    );
    expect(result.data.capabilities.canUnlockAll).toBe(false);
    expect(result.data.capabilities.canClearPresets).toBe(false);
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

  it("requires independent boolean preset clearing authority without ownership eligibility", async () => {
    const response = degradedView();
    response.savedPresetCount = 2;
    const result = await getCosmetics(client({ ok: true, cosmetics: response }));
    expect(result.ok).toBe(true);
    expect(result.data.capabilities.canUnlockAll).toBe(false);
    expect(result.data.capabilities.canClearPresets).toBe(true);
    for (const bad of [undefined, null, 1, "true"]) {
      const invalid = {
        ...response,
        capabilities: { ...response.capabilities, canClearPresets: bad },
      };
      expect((await getCosmetics(client({ ok: true, cosmetics: invalid }))).ok).toBe(false);
    }
  });

  it("accepts installed future IDs as read-only presentation metadata", async () => {
    const futureView = view(FUTURE_COSMETIC_ID + 1);
    const futureCosmetic = installedCosmeticAt(futureView, FUTURE_COSMETIC_ID);
    futureCosmetic.displayName = "Future Cosmetic";

    const result = await getCosmetics(client({ ok: true, cosmetics: futureView }));

    expect(result).toMatchObject({
      ok: true,
      data: {
        knownCatalogCount: FUTURE_COSMETIC_ID + 1,
        cosmetics: expect.arrayContaining([
          expect.objectContaining({
            id: FUTURE_COSMETIC_ID,
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
    updated.cosmetics[2].owned = true;
    updated.cosmetics[2].state = "owned";
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
      [
        {
          feature: "cosmetics",
          entity: String(FUTURE_COSMETIC_ID),
          field: "owned",
          after: true,
        },
      ],
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
    fabricatedUnknown.cosmetics[0].type = 7;
    await expect(
      getCosmetics(client({ ok: true, cosmetics: fabricatedUnknown })),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });

    const writableFuture = view(FUTURE_COSMETIC_ID + 1);
    const futureCosmetic = installedCosmeticAt(writableFuture, FUTURE_COSMETIC_ID);
    futureCosmetic.mutationEligible = true;
    futureCosmetic.removalBlockedReason = null;
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
