// @vitest-environment node

import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdvancedDomainDto } from "../contracts.cjs";

const require = createRequire(import.meta.url);
const { IPC_CHANNELS } = require("../../dist-electron/channels.cjs");
const { PythonClientError } = require("../../dist-electron/python/client.cjs");
const {
  getAdvancedSave,
  getRunState,
  listMaps,
  listUpgrades,
  registerEditorIpc,
} = require("../../dist-electron/ipc/editor.cjs");

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
];

describe("editor data IPC", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("registers every editor channel explicitly", () => {
    const registrar = { handle: vi.fn() };

    registerEditorIpc(client({}), registrar);

    expect(registrar.handle.mock.calls.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.upgradesList,
      IPC_CHANNELS.runGet,
      IPC_CHANNELS.advancedGet,
      IPC_CHANNELS.mapsList,
    ]);
    expect(registrar.handle.mock.calls.every(([, handler]) => typeof handler === "function"))
      .toBe(true);
  });

  it("forwards each domain to its exact Python command", async () => {
    const responses: Record<string, unknown> = {
      "upgrades-list": { ok: true, upgrades: [] },
      "run-get": {
        ok: true,
        run: { stats: [], resumeLocation: { value: "Normal", options: ["Normal"] } },
      },
      "advanced-get": {
        ok: true,
        advanced: { domains: advancedDomains, items: [], unlinkedChargeEntryCount: 0 },
      },
      "maps-list": { ok: true, available: false, catalogPath: null, maps: [] },
    };
    const fake = {
      run: vi.fn((command: string) => Promise.resolve(responses[command])),
      dispose: vi.fn(),
    };

    await listUpgrades(fake, saveId);
    await getRunState(fake, saveId);
    await getAdvancedSave(fake, saveId);
    await listMaps(fake);

    expect(fake.run.mock.calls).toEqual([
      ["upgrades-list", [saveId]],
      ["run-get", [saveId]],
      ["advanced-get", [saveId]],
      ["maps-list"],
    ]);
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

  it("parses dynamic installed and fallback upgrades with isolated icon tokens", async () => {
    const response = {
      ok: true,
      upgrades: [
        {
          key: "playerUpgradeStrength",
          label: "Strength",
          presentationSource: "installed",
          gameplayCap: 10,
          iconKey: "item upgrade player grab strength.png",
          values: [{ playerId: "111", value: 2 }],
        },
        {
          key: "playerUpgradeMoonBoots",
          label: "Moon Boots",
          presentationSource: "humanized",
          gameplayCap: null,
          iconKey: null,
          values: [{ playerId: "111", value: 7 }],
        },
      ],
    };
    const result = await listUpgrades(client(response), saveId);
    expect(result).toMatchObject({ ok: true, data: [{ presentationSource: "installed" }, { presentationSource: "humanized" }] });
    expect(result.data[0]).not.toHaveProperty("iconKey");
    expect(result.data[0].iconToken).toMatch(/^[\da-f-]{36}$/);
    expect(result.data[1].iconToken).toMatch(/^[\da-f-]{36}$/);

    await expect(
      listUpgrades(
        client({
          ...response,
          upgrades: [{ ...response.upgrades[0], iconKey: "../secret.png" }],
        }),
        saveId,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
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
          isUpgrade: false,
          storedCharge: 99,
          chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true,
          iconKey: "item melee inflatable hammer.png",
          rawValue: 21,
        },
      ],
      unlinkedChargeEntryCount: 0,
      rawSave: { secret: true },
    };

    const result = await getAdvancedSave(client({ ok: true, advanced }), saveId);

    expect(result).toMatchObject({
      ok: true,
      data: {
        items: [{ storedCharge: 99, chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true }],
      },
    });
    expect(result.data.items[0]).not.toHaveProperty("rawValue");
    expect(result.data.items[0]).not.toHaveProperty("iconKey");
    expect(result.data.items[0].iconToken).toMatch(/^[\da-f-]{36}$/);
    expect(result.data).not.toHaveProperty("rawSave");
    expect(result.data.domains[1].capabilities)
      .toMatchObject({ canEdit: false, canRefillToFull: true });
  });

  it("registers the same lazy upgrade visual path for upgrade Items without exposing its key", async () => {
    const advanced = {
      domains: advancedDomains,
      items: [
        {
          saveKey: "Item Upgrade Player Health/1",
          name: "Upgrade Player Health",
          instanceId: "1",
          isUpgrade: true,
          storedCharge: null,
          chargeState: "not_applicable",
          rechargeCapability: "not_rechargeable",
          canRefillToFull: false,
          iconKey: null,
          upgradeVisualKey: "playerUpgradeHealth",
        },
        {
          saveKey: "Item Modded Boost/2",
          name: "Modded Boost",
          instanceId: "2",
          isUpgrade: true,
          storedCharge: null,
          chargeState: "not_applicable",
          rechargeCapability: "not_rechargeable",
          canRefillToFull: false,
          iconKey: null,
        },
      ],
      unlinkedChargeEntryCount: 0,
    };

    const result = await getAdvancedSave(client({ ok: true, advanced }), saveId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected advanced data.");
    expect(result.data.items[0]!.iconToken).toMatch(/^[\da-f-]{36}$/);
    expect(result.data.items[0]).not.toHaveProperty("upgradeVisualKey");
    expect(result.data.items[1]!.iconToken).toBeNull();
  });

  it("accepts absent stored charge and rejects malformed advanced responses", async () => {
    const advanced = {
      domains: advancedDomains,
      items: [
        {
          saveKey: "Item Melee Inflatable Hammer/1",
          name: "Melee Inflatable Hammer",
          instanceId: "1",
          isUpgrade: false,
          storedCharge: null,
          chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false,
          iconKey: null,
        },
      ],
      unlinkedChargeEntryCount: 0,
    };
    await expect(getAdvancedSave(client({ ok: true, advanced }), saveId)).resolves.toMatchObject({
      ok: true,
      data: { items: [{ storedCharge: null, chargeState: "default_full", rechargeCapability: "rechargeable", canRefillToFull: false }] },
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
    await expect(
      getAdvancedSave(client({
        ok: true,
        advanced: { ...advanced, items: [{ ...advanced.items[0], iconKey: "../secret.png" }] },
      }), saveId),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });
    await expect(
      getAdvancedSave(client({
        ok: true,
        advanced: { ...advanced, items: [{ ...advanced.items[0], isUpgrade: "yes" }] },
      }), saveId),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_response" } });

    for (const item of [
      { ...advanced.items[0], chargeState: "guessed" },
      { ...advanced.items[0], chargeState: "stored", rechargeCapability: "rechargeable", canRefillToFull: true },
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
