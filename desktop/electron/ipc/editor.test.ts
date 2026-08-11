// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdvancedDomainDto } from "../contracts.cjs";

const require = createRequire(import.meta.url);
const { PythonClientError } = require("../../dist-electron/python/client.cjs");
const { getAdvancedSave, getRunState, listMaps, listUpgrades } = require("../../dist-electron/ipc/editor.cjs");

function client(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response), dispose: vi.fn() };
}

const saveId = "REPO_SAVE_2026_08_08_10_20_30";
const readOnlyCapabilities = {
  canRead: true,
  canEdit: false,
  canAdd: false,
  canDelete: false,
  canDuplicate: false,
  canRefillToFull: false,
} as const;
const advancedDomains: AdvancedDomainDto[] = [
  { key: "items", label: "Item instances", status: "confirmed", entryCount: 1, capabilities: readOnlyCapabilities },
  { key: "currentCharge", label: "Stored charge entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnlyCapabilities, canRefillToFull: true } },
  { key: "batteryUpgrades", label: "Battery upgrade entries", status: "unknown", entryCount: 0, capabilities: { ...readOnlyCapabilities, canRead: false } },
  { key: "purchasedUpgrades", label: "Purchased upgrade entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnlyCapabilities, canRead: false } },
  { key: "purchasedItems", label: "Purchased item entries", status: "partially_confirmed", entryCount: 1, capabilities: { ...readOnlyCapabilities, canRead: false } },
  { key: "purchasedItemsTotal", label: "Total purchased item entries", status: "partially_confirmed", entryCount: 2, capabilities: { ...readOnlyCapabilities, canRead: false } },
  { key: "runMetadata", label: "Additional Run values", status: "partially_confirmed", entryCount: 2, capabilities: readOnlyCapabilities },
];

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
    await expect(getAdvancedSave(fake, "../save")).resolves.toMatchObject({
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

  it("parses narrow advanced data and the precise refill capability", async () => {
    const advanced = {
      domains: advancedDomains,
      items: [
        {
          saveKey: "Item Melee Inflatable Hammer/1",
          name: "Melee Inflatable Hammer",
          instanceId: "1",
          storedCharge: 99,
          chargeState: "stored",
          rawValue: 21,
        },
      ],
      runValues: [
        {
          saveKey: "chargingStationCharge",
          label: "Charging station charge",
          value: 10,
          status: "partially_confirmed",
        },
      ],
      unlinkedChargeEntryCount: 0,
      rawSave: { secret: true },
    };

    const result = await getAdvancedSave(client({ ok: true, advanced }), saveId);

    expect(result).toMatchObject({
      ok: true,
      data: {
        items: [{ storedCharge: 99, chargeState: "stored" }],
        runValues: [{ saveKey: "chargingStationCharge", value: 10 }],
      },
    });
    expect(result.data.items[0]).not.toHaveProperty("rawValue");
    expect(result.data).not.toHaveProperty("rawSave");
    expect(result.data.domains[1].capabilities)
      .toMatchObject({ canEdit: false, canRefillToFull: true });
  });

  it("accepts absent stored charge and rejects malformed advanced responses", async () => {
    const advanced = {
      domains: advancedDomains,
      items: [
        {
          saveKey: "Item Melee Inflatable Hammer/1",
          name: "Melee Inflatable Hammer",
          instanceId: "1",
          storedCharge: null,
          chargeState: "default_full",
        },
      ],
      runValues: [],
      unlinkedChargeEntryCount: 0,
    };
    await expect(getAdvancedSave(client({ ok: true, advanced }), saveId)).resolves.toMatchObject({
      ok: true,
      data: { items: [{ storedCharge: null, chargeState: "default_full" }] },
    });

    const mutable = structuredClone(advanced) as unknown as {
      domains: Array<{ capabilities: { canEdit: boolean } }>;
    };
    mutable.domains[0].capabilities.canEdit = true;
    await expect(getAdvancedSave(client({ ok: true, advanced: mutable }), saveId)).resolves
      .toMatchObject({ ok: false, error: { code: "invalid_response" } });
    await expect(
      getAdvancedSave(client({ ok: true, advanced: { ...advanced, items: [{}] } }), saveId),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });

    for (const item of [
      { ...advanced.items[0], chargeState: "guessed" },
      { ...advanced.items[0], chargeState: "stored" },
    ]) {
      await expect(
        getAdvancedSave(client({ ok: true, advanced: { ...advanced, items: [item] } }), saveId),
      ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
    }

    const wrongDomain = structuredClone(advanced);
    wrongDomain.domains[0]!.capabilities.canRefillToFull = true;
    await expect(getAdvancedSave(client({ ok: true, advanced: wrongDomain }), saveId)).resolves
      .toMatchObject({ ok: false, error: { code: "invalid_response" } });
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
